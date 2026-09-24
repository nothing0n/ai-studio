import { PLATFORM_PRESETS, CUSTOM_PLATFORM, platformFor } from "./platforms.js";
import {
  TOKEN_LIMITS,
  TEMPERATURES,
  cleanModelOptions,
  modelCapabilities,
} from "./model-options.js";
import { endpointURL } from "./data.js";
import { fetchModels } from "./ai.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const option = (value, name, selected) =>
  `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(name)}</option>`;
const field = (label, input, hint = "") =>
  `<label class="field"><span>${label}</span>${input.replace(/^<(input|select)/, `<$1 aria-label="${label}"`)}${hint ? `<small>${hint}</small>` : ""}</label>`;
const modelChoices = (models, selected) =>
  [...new Set([selected, ...models].filter(Boolean))]
    .map((id) => option(id, id, selected))
    .join("") + option("__custom__", "自定义模型…", selected || "__custom__");
const endpointChoices = (platform, selected) => {
  const entries = [...platform.endpoints];
  if (selected && !entries.some((entry) => entry[1] === selected))
    entries.push(["已保存的接口", selected]);
  return entries
    .map(([name, url]) => option(url, `${name} · ${url}`, selected || entries[0]?.[1]))
    .join("");
};
const levelNames = {
  none: "关闭思考",
  minimal: "极轻",
  low: "轻量",
  medium: "标准",
  high: "深入",
  xhigh: "更深入",
  max: "最高",
};

function parameterFields(provider) {
  const settings = cleanModelOptions(provider.options),
    caps = modelCapabilities({ ...provider, options: settings });
  return `<div class="field-row">${field("思考程度", `<select name="reasoning" ${caps.reasoning.length ? "" : "disabled"}>${option("auto", "模型默认", settings.reasoning)}${caps.reasoning.map((value) => option(value, levelNames[value], settings.reasoning)).join("")}</select>`)}${field("回答随机性", `<select name="temperature" ${caps.temperature ? "" : "disabled"}>${option("auto", caps.temperature ? "模型默认" : "由模型控制", settings.temperature ?? "auto")}${caps.temperature ? TEMPERATURES.map((value, index) => option(value, ["严谨", "均衡", "发散"][index], settings.temperature)).join("") : ""}</select>`)}</div><div class="field-row">${field("生成 Token 上限", `<select name="maxTokens">${option("auto", "模型默认", settings.maxTokens ?? "auto")}${TOKEN_LIMITS.map((value) => option(value, value.toLocaleString("zh-CN"), settings.maxTokens)).join("")}</select>`, "Token 是用量单位；上限可能包含思考消耗，不等于字数。")}${field("回复显示", `<select name="streaming">${option("true", "逐字显示", settings.streaming)}${option("false", "完整显示", settings.streaming)}</select>`)}</div>`;
}

export function renderModelForm(editing, savedKey) {
  const platform = editing ? platformFor(editing.baseUrl) : PLATFORM_PRESETS[0];
  const baseUrl = editing?.baseUrl || platform.endpoints[0]?.[1] || "";
  const model = editing?.model || platform.models[0] || "";
  const provider = { ...editing, baseUrl, model };
  return `<form id="provider-form"><h3>${editing ? "编辑模型连接" : "添加模型连接"}</h3>
    ${field("模型平台", `<select name="platform">${[...PLATFORM_PRESETS, CUSTOM_PLATFORM].map((entry) => option(entry.id, entry.name, platform.id)).join("")}</select>`)}
    <div id="endpoint-field">${platform.id === "custom" ? field("接口地址（Base URL）", `<input type="url" name="baseUrl" required value="${esc(baseUrl)}" placeholder="https://api.example.com/v1">`) : field("接口地址（Base URL）", `<select name="baseUrl">${endpointChoices(platform, baseUrl)}</select>`)}</div>
    ${field("API Key", `<input name="apiKey" type="password" autocomplete="off" placeholder="粘贴你的密钥" value="${esc(savedKey?.baseUrl === baseUrl ? savedKey.key : "")}">`, "密钥仅保存在本次浏览器会话。切换接口后需要重新填写。")}
    <div class="model-picker">${field("模型名称", `<select name="model">${modelChoices(platform.models, model)}</select>`)}<button class="secondary-button" type="button" id="load-models" ${platform.discovery === false ? "disabled" : ""}>读取可用模型</button></div>
    <p id="model-discovery-status" class="field-hint" role="status">常用模型预设；填写密钥后可读取账号支持的模型。</p>
    <div id="custom-model-field" ${model ? "hidden" : ""}>${field("自定义模型名称", `<input name="customModel" maxlength="160" placeholder="仅当接口未提供模型列表时填写" ${model ? "" : "required"}>`)}</div>
    <details class="model-advanced"><summary>生成参数与连接名称</summary><div id="model-parameters">${parameterFields(provider)}</div>${field("连接名称", `<input name="name" maxlength="80" value="${esc(editing?.name || platform.name)}">`)}</details>
    <div class="form-actions">${editing ? '<button class="secondary-button" type="button" data-action="new-provider">添加其他连接</button>' : ""}<button class="primary-button" type="submit">保存连接</button></div></form>`;
}

export function providerFormValue(form) {
  const model =
    form.elements.model.value === "__custom__"
      ? form.elements.customModel.value.trim()
      : form.elements.model.value;
  const options = cleanModelOptions({
    maxTokens: Number(form.elements.maxTokens.value),
    temperature: Number(form.elements.temperature.value),
    reasoning: form.elements.reasoning.value,
    streaming: form.elements.streaming.value !== "false",
  });
  const baseUrl = endpointURL(form.elements.baseUrl.value.trim());
  const caps = modelCapabilities({ baseUrl, model, options });
  if (!caps.temperature) options.temperature = null;
  if (!caps.reasoning.includes(options.reasoning)) options.reasoning = "auto";
  return {
    model,
    baseUrl,
    options,
    name: form.elements.name.value.trim() || platformFor(baseUrl).name,
  };
}

export function bindModelForm(dialog) {
  const form = dialog.querySelector("#provider-form"),
    status = dialog.querySelector("#model-discovery-status");
  let controller = null;
  const cancel = () => {
    controller?.abort();
    controller = null;
    form.querySelector("#load-models").disabled = form.elements.platform.value === "claude";
  };
  const selectedPlatform = () =>
    PLATFORM_PRESETS.find((entry) => entry.id === form.elements.platform.value) || CUSTOM_PLATFORM;
  const refreshParameters = (preserve = false) => {
    let options = {};
    if (preserve) options = providerFormValue(form).options;
    const model =
      form.elements.model.value === "__custom__"
        ? form.elements.customModel.value
        : form.elements.model.value;
    form.querySelector("#model-parameters").innerHTML = parameterFields({
      baseUrl: form.elements.baseUrl.value,
      model,
      options,
    });
    const custom = form.elements.model.value === "__custom__";
    form.querySelector("#custom-model-field").hidden = !custom;
    form.elements.customModel.required = custom;
  };
  const endpointChanged = () => {
    cancel();
    form.elements.apiKey.value = "";
    const platform = selectedPlatform();
    form.elements.model.innerHTML = modelChoices(platform.models, platform.models[0]);
    status.textContent = "接口已切换，请重新填写对应的密钥。";
    refreshParameters();
  };
  form.elements.platform.addEventListener("change", () => {
    const platform = selectedPlatform();
    form.querySelector("#endpoint-field").innerHTML =
      platform.id === "custom"
        ? field(
            "接口地址（Base URL）",
            '<input name="baseUrl" type="url" required placeholder="https://api.example.com/v1">',
          )
        : field(
            "接口地址（Base URL）",
            `<select name="baseUrl">${endpointChoices(platform)}</select>`,
          );
    form.elements.name.value = platform.name;
    form.elements.baseUrl.addEventListener("change", endpointChanged);
    endpointChanged();
  });
  form.elements.baseUrl.addEventListener("change", endpointChanged);
  form.elements.apiKey.addEventListener("input", () => {
    if (controller) {
      cancel();
      status.textContent = "密钥已更新，请重新读取模型列表";
    }
  });
  form.elements.model.addEventListener("change", () => refreshParameters());
  form.elements.customModel.addEventListener("change", () => refreshParameters());
  form.querySelector("#model-parameters").addEventListener("change", (event) => {
    if (event.target.name === "reasoning") refreshParameters(true);
  });
  dialog.addEventListener("dismiss", cancel);
  dialog.addEventListener("close", cancel);
  form.querySelector("#load-models").addEventListener("click", async () => {
    cancel();
    let baseUrl;
    try {
      baseUrl = endpointURL(form.elements.baseUrl.value.trim());
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const key = form.elements.apiKey.value.trim();
    if (!key && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(baseUrl)) {
      status.textContent = "请先填写 API Key，再读取账号可用模型";
      return;
    }
    const request = new AbortController();
    controller = request;
    form.querySelector("#load-models").disabled = true;
    status.textContent = "正在读取可用模型…";
    const timeout = setTimeout(() => request.abort(), 15000);
    try {
      const models = await fetchModels({ baseUrl, apiKey: key, signal: request.signal });
      if (
        !dialog.isConnected ||
        controller !== request ||
        request.signal.aborted ||
        form.elements.apiKey.value.trim() !== key
      )
        return;
      const current = form.elements.model.value;
      form.elements.model.innerHTML = modelChoices(
        models,
        models.includes(current) ? current : models[0],
      );
      refreshParameters();
      status.textContent = `已读取 ${models.length} 个模型；列表不保证每个模型都支持当前聊天接口。`;
    } catch (error) {
      if (dialog.isConnected && controller === request)
        status.textContent = request.signal.aborted
          ? "读取超时，可稍后重试或选择常用模型"
          : error.name === "TypeError"
            ? "无法读取模型列表，请检查网络与浏览器跨域支持"
            : error.message;
    } finally {
      clearTimeout(timeout);
      if (controller === request) {
        controller = null;
        form.querySelector("#load-models").disabled = selectedPlatform().discovery === false;
      }
    }
  });
}
