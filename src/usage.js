const PREFIX = "ai-studio:usage:v1:";
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const input = count(raw.prompt_tokens ?? raw.input_tokens ?? raw.input);
  const output = count(raw.completion_tokens ?? raw.output_tokens ?? raw.output);
  const total =
    count(raw.total_tokens ?? raw.total) ??
    (input !== null && output !== null ? input + output : null);
  if (input === null && output === null && total === null) return null;
  return {
    input,
    output,
    total,
    cached: count(
      raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? raw.cached,
    ),
    reasoning: count(raw.completion_tokens_details?.reasoning_tokens ?? raw.reasoning),
  };
}

// A request owns a unique key. Other tabs never overwrite its record.
export function saveUsage(record, storage = localStorage) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(record.id || "")) throw new Error("无效的用量记录");
  const safe = {
    id: record.id,
    providerId: String(record.providerId || "").slice(0, 120),
    providerName: String(record.providerName || "").slice(0, 80),
    baseUrl: String(record.baseUrl || "").slice(0, 1000),
    model: String(record.model || "").slice(0, 160),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    purpose: ["chat", "router", "summary", "test"].includes(record.purpose)
      ? record.purpose
      : "chat",
    status: ["pending", "success", "error", "aborted"].includes(record.status)
      ? record.status
      : "pending",
    usage: normalizeUsage(record.usage),
  };
  storage.setItem(PREFIX + safe.id, JSON.stringify(safe));
  return safe;
}

export function readUsage(storage = localStorage) {
  const records = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const record = JSON.parse(storage.getItem(key));
      if (key !== PREFIX + record.id || !Number.isFinite(Date.parse(record.startedAt))) continue;
      records.push({ ...record, usage: normalizeUsage(record.usage) });
    } catch {
      /* One damaged entry must not hide all other usage. */
    }
  }
  return records;
}

export function summarizeUsage(
  records,
  { providerId, baseUrl, period = "all", date = new Date() } = {},
) {
  const from =
    period === "today"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      : period === "month"
        ? new Date(date.getFullYear(), date.getMonth(), 1).getTime()
        : 0;
  const filtered = records.filter(
    (record) =>
      (!providerId || record.providerId === providerId) &&
      (!baseUrl || record.baseUrl === baseUrl) &&
      Date.parse(record.startedAt) >= from,
  );
  const sum = (field) => {
    const known = filtered.filter((record) => record.usage?.[field] != null);
    return known.length
      ? known.reduce((total, record) => total + record.usage[field], 0)
      : filtered.length
        ? null
        : 0;
  };
  return {
    requests: filtered.length,
    unknown: filtered.filter((record) => record.usage?.total == null).length,
    pending: filtered.filter((record) => record.status === "pending").length,
    input: sum("input"),
    output: sum("output"),
    total: sum("total"),
    cached: sum("cached"),
  };
}

export function isUsageKey(key) {
  return key?.startsWith(PREFIX);
}
