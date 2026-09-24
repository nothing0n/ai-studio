import { platformFor } from "./platforms.js";
import { readUsage, summarizeUsage } from "./usage.js";
import { balanceEndpoint, fetchBalance } from "./balance.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
const num = (value) => (value == null ? "—" : value.toLocaleString("zh-CN"));
export function createUsagePanel({ provider: getProvider, key: getKey }) {
  const cache = new Map();
  let period = "month",
    incomplete = false;
  function identity(provider) {
    try {
      return provider ? getKey(provider) : "";
    } catch {
      return "";
    }
  }
  function entryFor(provider) {
    const saved = cache.get(provider?.id);
    return saved?.baseUrl === provider?.baseUrl && saved?.credential === identity(provider)
      ? saved
      : null;
  }
  function markup() {
    const provider = getProvider(),
      platform = platformFor(provider?.baseUrl),
      entry = entryFor(provider);
    let records = [];
    try {
      records = readUsage();
    } catch {
      incomplete = true;
    }
    const stats = summarizeUsage(records, {
      providerId: provider?.id,
      baseUrl: provider?.baseUrl,
      period,
    });
    const supported = provider && balanceEndpoint(provider),
      key = identity(provider);
    const dashboard =
      platform.id === "kimi" && provider.baseUrl.includes("moonshot.ai")
        ? "https://platform.kimi.ai/console"
        : platform.dashboard;
    const balance = entry?.data?.balances
      .map(
        (item) =>
          `${item.currency === "CNY" ? "¥" : "$"}${item.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`,
      )
      .join(" / ");
    const note = entry?.error
      ? "查询失败 · 可重试"
      : entry?.loading
        ? "正在更新余额…"
        : entry?.data
          ? `${new Date(entry.data.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 更新${entry.data.available ? "" : " · 账户不可用"}`
          : !provider
            ? "先选择模型连接"
            : supported
              ? key
                ? "等待查询"
                : "填写密钥后可查询"
              : platform.id === "openai"
                ? "普通密钥无法直接查询余额"
                : "此接口暂不支持余额查询";
    const balanceDetails = `${provider?.name || "账户余额"} · ${note}${entry?.error ? ` · ${entry.error}` : ""}`;
    const balanceLabel = `余额 <span data-balance-value>${balance || (dashboard ? "↗" : "—")}</span>`;
    const usageDetails = `${provider?.name || "当前连接"} · 本网页用量 · 本浏览器 · 输入 ${num(stats.input)} · 输出 ${num(stats.output)} · ${stats.requests} 次请求${stats.unknown ? ` · ${stats.unknown} 次用量未返回` : ""}${stats.pending ? ` · ${stats.pending} 次结果未确认` : ""}${incomplete ? " · 部分用量未能保存，统计可能不完整" : ""}`;
    const usageUnknown = stats.total == null || (incomplete && !stats.requests);
    const usageStatus = incomplete || stats.unknown ? "部分" : stats.pending ? "待更新" : "";
    return `<span class="account-balance" title="${esc(balanceDetails)}">
      ${dashboard ? `<a href="${platform.billing || dashboard}" target="_blank" rel="noopener noreferrer" aria-label="查看平台账户余额：${esc(balanceDetails)}">${balanceLabel}</a>` : `<span aria-label="${esc(balanceDetails)}">${balanceLabel}</span>`}${entry?.error || entry?.data?.available === false ? '<span class="usage-warning" aria-label="余额状态异常">!</span>' : ""}${supported ? `<button id="refresh-balance" type="button" ${entry?.loading ? "disabled" : ""} title="刷新账户余额" aria-label="刷新账户余额">↻</button>` : ""}
      </span><span class="usage-separator" aria-hidden="true">·</span>
      <label><span class="sr-only">用量时间范围</span><select id="usage-period" aria-label="用量时间范围">${[
        ["today", "今日"],
        ["month", "本月"],
        ["all", "累计"],
      ]
        .map(
          ([value, name]) =>
            `<option value="${value}" ${period === value ? "selected" : ""}>${name}</option>`,
        )
        .join("")}</select></label>
      <span class="site-usage" title="${esc(usageDetails)}" aria-label="${esc(usageDetails)}">${usageUnknown ? `<span data-usage-total>${stats.pending ? "用量待更新" : incomplete ? "用量未完整记录" : "用量未返回"}</span>` : `已用 <span data-usage-total>${num(stats.total)} Token</span>${usageStatus ? `<span class="usage-warning"> · ${usageStatus}</span>` : ""}`}</span>`;
  }
  function paint() {
    const panel = document.querySelector("#usage-panel");
    if (panel) panel.innerHTML = markup();
  }
  async function refresh(force = false) {
    const provider = getProvider();
    if (!provider || !balanceEndpoint(provider)) return;
    const credential = identity(provider);
    if (!credential) return;
    const prior = entryFor(provider);
    if (prior?.loading || (!force && prior && Date.now() - prior.at < 60000)) return;
    const request = new AbortController();
    const entry = {
      baseUrl: provider.baseUrl,
      credential,
      at: Date.now(),
      loading: true,
      data: prior?.data,
      controller: request,
    };
    cache.set(provider.id, entry);
    paint();
    const timer = setTimeout(() => request.abort(), 15000);
    try {
      entry.data = await fetchBalance({
        provider: { ...provider },
        apiKey: credential,
        signal: request.signal,
      });
    } catch (error) {
      entry.error = error.message;
    } finally {
      clearTimeout(timer);
      entry.loading = false;
      entry.at = Date.now();
      paint();
    }
  }
  document.addEventListener("change", (event) => {
    if (event.target.id === "usage-period") {
      period = event.target.value;
      paint();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("#refresh-balance")) refresh(true);
  });
  return {
    html: () =>
      `<aside id="usage-panel" class="usage-panel" aria-label="账户余额与本网页用量">${markup()}</aside>`,
    update: paint,
    refresh,
    markIncomplete() {
      incomplete = true;
      paint();
    },
    invalidate(id) {
      if (id) {
        cache.get(id)?.controller?.abort();
        cache.delete(id);
      } else {
        for (const value of cache.values()) value.controller?.abort();
        cache.clear();
      }
      paint();
    },
  };
}
