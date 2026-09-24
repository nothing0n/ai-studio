import { DEFAULT_REPOSITORY } from "./platforms.js";
import { parseRepository } from "./github.js";
import { fetchRepositories, fetchBranches, testGitHubConnection } from "./github-connection.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
const field = (label, input) =>
  `<label class="field"><span>${label}</span>${input.replace(/^<(input|select)/, `<$1 aria-label="${label}"`)}</label>`;
const repositoryOptions = (repositories, selected) =>
  [...new Set([selected, ...repositories].filter((name) => name && name !== "__custom__"))]
    .map((name) => option(name, name, selected))
    .join("") + option("__custom__", "手动填写其他仓库…", selected);
const branchOptions = (branches, selected = "") =>
  option("", "默认分支（自动）", selected) +
  [...new Set([selected, ...branches].filter((name) => name && name !== "__custom__"))]
    .map((name) => option(name, name, selected))
    .join("") +
  option("__custom__", "手动填写分支…", selected);

export function renderGitHubForm({ repository, branch, token, busy, error }) {
  return `<form id="github-form">
    ${field("GitHub 访问令牌", `<input name="token" type="password" required autocomplete="off" placeholder="github_pat_…" value="${esc(token)}">`)}
    <div class="model-picker">${field("数据仓库", `<select name="repository">${repositoryOptions([DEFAULT_REPOSITORY], repository || DEFAULT_REPOSITORY)}</select>`)}<button class="secondary-button" type="button" id="load-repositories">读取仓库</button></div>
    <div id="custom-repository-field" hidden>${field("手动仓库地址", '<input name="customRepository" placeholder="用户名/私有数据仓库，或完整 GitHub 地址">')}</div>
    <p class="field-hint" id="repository-status" role="status">填写令牌后可读取已授权的私有仓库。</p>
    <div class="model-picker">${field("分支", `<select name="branch">${branchOptions([], branch)}</select>`)}<button class="secondary-button" type="button" id="load-branches">读取分支</button></div>
    <div id="custom-branch-field" hidden>${field("手动分支名称", '<input name="customBranch" placeholder="已存在的分支名称">')}</div>
    <p class="field-hint" id="branch-status" role="status">通常选择默认分支即可；空仓库会在首次同步时初始化。</p>
    <div class="connection-test"><button class="secondary-button" type="button" id="test-github">测试连通性</button><span id="github-test-status" role="status">检查仓库访问，不写入数据。</span></div>
    <div class="help-links"><a href="https://github.com/new" target="_blank" rel="noopener noreferrer">创建私有仓库 ↗</a><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建访问令牌 ↗</a></div>
    <details class="sync-explanation"><summary>权限与同步说明</summary><p>令牌仅授权数据仓库的 Contents → Read and write，只保存在本次浏览器会话。</p><p>每轮回答后自动同步，电脑和手机的新增消息会合并；失败时保留本机记录。仓库保留历史版本，模型密钥与 GitHub 令牌不会上传。</p></details>
    ${error ? `<div class="inline-error">${esc(error)}</div>` : ""}
    <div class="form-actions">${repository ? '<button class="secondary-button" type="button" data-action="disconnect">断开同步</button>' : ""}<button class="primary-button" type="submit" ${busy ? "disabled" : ""}>连接并同步</button></div></form>`;
}

export function githubFormValue(form) {
  const repository = parseRepository(
    form.elements.repository.value === "__custom__"
      ? form.elements.customRepository.value
      : form.elements.repository.value,
  );
  const token = form.elements.token.value.trim();
  if (!token) throw new Error("请填写 GitHub 访问令牌");
  const branch = (
    form.elements.branch.value === "__custom__"
      ? form.elements.customBranch.value
      : form.elements.branch.value
  ).trim();
  if (form.elements.branch.value === "__custom__" && !branch)
    throw new Error("请填写分支名称或选择默认分支");
  return { repository, token, branch };
}

export function bindGitHubForm(dialog) {
  const form = dialog.querySelector("#github-form");
  let controller = null;
  const buttons = ["load-repositories", "load-branches", "test-github"].map((id) =>
    form.querySelector(`#${id}`),
  );
  const testStatus = form.querySelector("#github-test-status");
  const cancel = () => {
    controller?.abort();
    controller = null;
    for (const button of buttons) button.disabled = false;
    for (const status of form.querySelectorAll('[data-state="loading"]')) {
      status.textContent = "配置已更改，请重试。";
      status.dataset.state = "";
    }
  };
  const changed = () => {
    cancel();
    testStatus.textContent = "配置已更改，请重新测试。";
    testStatus.dataset.state = "";
  };
  const run = async (status, action) => {
    cancel();
    const request = new AbortController();
    controller = request;
    const timer = setTimeout(() => request.abort(), 30000);
    for (const button of buttons) button.disabled = true;
    status.textContent = "正在连接…";
    status.dataset.state = "loading";
    try {
      const apply = await action(request.signal);
      if (dialog.isConnected && controller === request && !request.signal.aborted) apply();
    } catch (error) {
      if (dialog.isConnected && controller === request) {
        status.textContent = request.signal.aborted
          ? "连接超时，请检查网络后重试。"
          : error.message;
        status.dataset.state = "error";
      }
    } finally {
      clearTimeout(timer);
      if (controller === request) {
        controller = null;
        for (const button of buttons) button.disabled = false;
      }
    }
  };
  const loadBranches = () =>
    run(form.querySelector("#branch-status"), async (signal) => {
      const values = githubFormValue(form);
      const result = await fetchBranches({ ...values, signal });
      return () => {
        form.elements.branch.innerHTML = branchOptions(result.branches, values.branch);
        form.querySelector("#custom-branch-field").hidden = true;
        form.elements.customBranch.required = false;
        const status = form.querySelector("#branch-status");
        status.textContent = result.branches.length
          ? `已读取 ${result.branches.length} 个分支${result.truncated ? "（仅前 1,000 个，可手动填写）" : ""}。`
          : "仓库暂无分支，首次同步时会初始化默认分支。";
        status.dataset.state = "success";
      };
    });
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.elements.token.addEventListener("input", () => {
    const repository = form.elements.repository.value;
    form.elements.repository.innerHTML = repositoryOptions(
      repository === "__custom__" ? [] : [repository],
      repository,
    );
    form.elements.branch.innerHTML = branchOptions([], form.elements.branch.value);
    form.querySelector("#repository-status").textContent = "令牌已更改，请重新读取仓库。";
    form.querySelector("#branch-status").textContent = "请重新读取分支。";
  });
  form.elements.repository.addEventListener("change", () => {
    const custom = form.elements.repository.value === "__custom__";
    form.querySelector("#custom-repository-field").hidden = !custom;
    form.elements.customRepository.required = custom;
    form.elements.branch.innerHTML = branchOptions([]);
    form.querySelector("#custom-branch-field").hidden = true;
    form.elements.customBranch.required = false;
    form.querySelector("#branch-status").textContent = "可读取当前仓库的分支。";
  });
  form.elements.branch.addEventListener("change", () => {
    const custom = form.elements.branch.value === "__custom__";
    form.querySelector("#custom-branch-field").hidden = !custom;
    form.elements.customBranch.required = custom;
  });
  form.elements.customRepository.addEventListener("input", () => {
    form.elements.branch.innerHTML = branchOptions([]);
    form.querySelector("#custom-branch-field").hidden = true;
    form.elements.customBranch.required = false;
  });
  buttons[0].addEventListener("click", () =>
    run(form.querySelector("#repository-status"), async (signal) => {
      const result = await fetchRepositories({ token: form.elements.token.value.trim(), signal });
      return () => {
        const current = form.elements.repository.value;
        form.elements.repository.innerHTML = repositoryOptions(
          result.repositories.map((repo) => repo.name),
          current,
        );
        const status = form.querySelector("#repository-status");
        status.textContent = result.repositories.length
          ? `已读取 ${result.repositories.length} 个私有仓库${result.truncated ? "（列表可能不完整，可手动填写）" : ""}。`
          : "未找到已授权的私有仓库，请检查令牌授权或手动填写。";
        status.dataset.state = result.repositories.length ? "success" : "";
      };
    }),
  );
  buttons[1].addEventListener("click", loadBranches);
  buttons[2].addEventListener("click", () =>
    run(testStatus, async (signal) => {
      const result = await testGitHubConnection({ ...githubFormValue(form), signal });
      return () => {
        testStatus.textContent = `${result.empty ? "已连通：私有空仓库" : "已连通，私有仓库内容可读取"} · ${result.branch || "默认分支"}。写入权限将在同步时验证。`;
        testStatus.dataset.state = "success";
      };
    }),
  );
  dialog.addEventListener("dismiss", cancel);
  dialog.addEventListener("close", cancel);
}
