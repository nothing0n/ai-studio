import { fetchModels } from "./ai.js";
import { platformFor } from "./platforms.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

export function createModelPicker({
  provider: getProvider,
  providers: getProviders,
  key: getKey,
  select,
}) {
  const catalogs = new Map();
  const credential = (provider) => {
    try {
      return getKey(provider);
    } catch {
      return "";
    }
  };
  function entryFor(provider) {
    const entry = catalogs.get(provider.id);
    return entry?.baseUrl === provider.baseUrl && entry?.key === credential(provider)
      ? entry
      : null;
  }
  function choices(provider) {
    const entry = entryFor(provider);
    return [
      ...new Set(
        [
          provider.model,
          ...(entry?.models || platformFor(provider.baseUrl).models),
          ...getProviders()
            .filter((item) => item.baseUrl === provider.baseUrl)
            .map((item) => item.model),
        ].filter(Boolean),
      ),
    ];
  }
  const options = (provider) =>
    choices(provider)
      .map(
        (model) =>
          `<option value="${esc(model)}" ${model === provider.model ? "selected" : ""}>${esc(model)}</option>`,
      )
      .join("");
  function paint() {
    const picker = document.querySelector("#composer-model"),
      provider = getProvider();
    if (picker && provider && picker.dataset.provider === provider.id)
      picker.innerHTML = options(provider);
  }
  function remember(provider, key, models) {
    catalogs.get(provider.id)?.controller?.abort();
    catalogs.set(provider.id, { baseUrl: provider.baseUrl, key, models });
    paint();
  }
  async function load(provider) {
    const key = credential(provider);
    if (entryFor(provider) || platformFor(provider.baseUrl).discovery === false) return;
    if (!key && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/.test(provider.baseUrl))
      return;
    catalogs.get(provider.id)?.controller?.abort();
    const controller = new AbortController();
    const entry = { baseUrl: provider.baseUrl, key, controller };
    catalogs.set(provider.id, entry);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const models = await fetchModels({
        baseUrl: provider.baseUrl,
        apiKey: key,
        signal: controller.signal,
      });
      if (controller.signal.aborted || catalogs.get(provider.id) !== entry) return;
      entry.models = models;
      paint();
    } catch {
      // Keep the selected model and presets available when discovery is unsupported or offline.
      if (catalogs.get(provider.id) === entry) catalogs.delete(provider.id);
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    html(disabled = false) {
      const provider = getProvider();
      return `<label class="composer-model-picker"><select id="composer-model" aria-label="当前模型" data-provider="${esc(provider?.id)}" title="${esc(provider ? `${provider.name} · ${provider.model}；切换会应用于使用此连接的成员` : "请先在设置中添加模型连接")}" ${disabled || !provider ? "disabled" : ""}>${provider ? options(provider) : "<option>未配置模型</option>"}</select><span aria-hidden="true">⌄</span></label>`;
    },
    bind() {
      const picker = document.querySelector("#composer-model"),
        provider = getProvider();
      if (!picker || !provider) return;
      picker.addEventListener("focus", () => load(provider));
      picker.addEventListener("change", () => {
        const current = getProvider();
        if (current?.id === picker.dataset.provider && choices(current).includes(picker.value))
          select(current, picker.value);
      });
    },
    remember,
    invalidate(id) {
      for (const [providerId, entry] of catalogs) {
        if (!id || id === providerId) {
          entry.controller?.abort();
          catalogs.delete(providerId);
        }
      }
      paint();
    },
  };
}
