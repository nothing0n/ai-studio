import { GitHubError, parseRepository } from "./github.js";

async function request(path, { token, signal, fetchImpl = fetch }) {
  if (!token?.trim()) throw new GitHubError("请先填写 GitHub 访问令牌");
  let response;
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.trim()}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GitHubError("无法连接 GitHub，请检查网络后重试");
  }
  if (!response.ok) {
    const messages = {
      401: "访问令牌无效或已过期，请重新填写",
      403: "GitHub 拒绝访问，请检查仓库授权、Contents 权限或稍后重试",
      404: "找不到仓库或分支，请检查名称和令牌的仓库授权",
      429: "GitHub 请求过于频繁，请稍后重试",
    };
    const error = new GitHubError(
      messages[response.status] || `GitHub 请求失败（${response.status}）`,
      response.status,
    );
    const body = await response.json().catch(() => null);
    // Only recognize explicit empty-repository responses, never a generic 404/409.
    error.emptyRepository =
      [404, 409].includes(response.status) &&
      /^(?:Git Repository is empty|This repository is empty)\.?$/i.test(body?.message || "");
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new GitHubError("GitHub 返回的数据格式不正确，请稍后重试");
  }
}

function root(repository) {
  return `/repos/${parseRepository(repository).split("/").map(encodeURIComponent).join("/")}`;
}

async function list(path, options) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      options,
    );
    if (!Array.isArray(batch)) throw new GitHubError("GitHub 返回的列表格式不正确");
    items.push(...batch);
    if (batch.length < 100) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export async function fetchRepositories(options) {
  const result = await list("/user/repos?visibility=private&sort=updated", options);
  return {
    repositories: result.items
      .filter((repo) => repo.private && !repo.archived && !repo.disabled)
      .map((repo) => ({
        name: parseRepository(repo.full_name),
        defaultBranch: repo.default_branch,
      })),
    truncated: result.truncated,
  };
}

export async function fetchBranches({ repository, ...options }) {
  try {
    const result = await list(`${root(repository)}/branches`, options);
    return { branches: result.items.map((branch) => branch.name), truncated: result.truncated };
  } catch (error) {
    if (error.emptyRepository) return { branches: [], truncated: false };
    throw error;
  }
}

export async function testGitHubConnection({ repository, branch = "", ...options }) {
  const path = root(repository);
  const repo = await request(path, options);
  if (!repo.private) throw new GitHubError("请选择 Private 私有仓库，聊天记录不能同步到公开仓库");
  if (repo.archived || repo.disabled)
    throw new GitHubError("该仓库已归档或不可用，请选择其他私有仓库");
  if (branch) await request(`${path}/branches/${encodeURIComponent(branch)}`, options);
  try {
    const contents = await request(
      `${path}/contents${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`,
      options,
    );
    if (!Array.isArray(contents)) throw new GitHubError("仓库内容列表格式不正确，请稍后重试");
    return {
      repository: parseRepository(repository),
      branch: branch || repo.default_branch,
      empty: false,
    };
  } catch (error) {
    if (error.emptyRepository && !branch)
      return { repository: parseRepository(repository), branch: repo.default_branch, empty: true };
    throw error;
  }
}
