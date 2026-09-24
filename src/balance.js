import { platformFor } from "./platforms.js";
import { safeErrorMessage } from "./ai.js";

export function balanceEndpoint(provider) {
  const platform = platformFor(provider.baseUrl);
  if (platform.id === "deepseek") return "https://api.deepseek.com/user/balance";
  if (platform.id === "kimi") return `${provider.baseUrl.replace(/\/+$/, "")}/users/me/balance`;
  return null;
}
function amount(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)))
    throw new Error("平台返回的余额格式不正确");
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error("平台返回的余额格式不正确");
  return numeric;
}
export async function fetchBalance({ provider, apiKey, signal, fetchImpl = fetch }) {
  const endpoint = balanceEndpoint(provider);
  if (!endpoint) throw new Error("该平台暂不支持直接读取余额");
  if (!apiKey) throw new Error("请先填写此连接的 API Key");
  let response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (signal?.aborted) throw new Error("余额查询已超时或取消，可稍后刷新");
    throw new Error("无法读取余额，请检查网络或打开官方控制台");
  }
  if (!response.ok) throw new Error(safeErrorMessage(response.status));
  const json = await response.json(),
    platform = platformFor(provider.baseUrl);
  let balances;
  if (platform.id === "deepseek") {
    if (!Array.isArray(json.balance_infos) || !json.balance_infos.length)
      throw new Error("平台未返回余额");
    balances = json.balance_infos.map((row) => {
      if (!["CNY", "USD"].includes(row.currency)) throw new Error("平台返回的币种暂不支持");
      return { currency: row.currency, amount: amount(row.total_balance) };
    });
  } else {
    if (json.code !== 0 || json.status !== true || !json.data) throw new Error("平台未返回余额");
    balances = [
      {
        currency: endpoint.startsWith("https://api.moonshot.ai/") ? "USD" : "CNY",
        amount: amount(json.data.available_balance),
      },
    ];
  }
  return { balances, checkedAt: new Date().toISOString(), available: json.is_available !== false };
}
