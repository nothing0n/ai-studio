import test from "node:test";
import assert from "node:assert/strict";
import { completeChat, selectBot, fetchModels } from "../src/ai.js";
import { normalizeUsage, saveUsage, readUsage, summarizeUsage } from "../src/usage.js";
import { requestOptions, modelCapabilities } from "../src/model-options.js";
import { fetchBalance, balanceEndpoint } from "../src/balance.js";
import { cleanState, initialState, mergeStates, clone } from "../src/data.js";
const provider = {
  id: "test",
  name: "测试",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4",
};
const usage = {
  prompt_tokens: 100,
  completion_tokens: 25,
  total_tokens: 125,
  prompt_tokens_details: { cached_tokens: 40 },
  completion_tokens_details: { reasoning_tokens: 5 },
};
const jsonReply = (extra = {}) =>
  Response.json({ choices: [{ message: { content: "回答" }, finish_reason: "stop" }], ...extra });
const sse = (...chunks) =>
  new Response(
    chunks
      .map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
function memoryStorage() {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("stream usage is captured before empty choices and cumulative frames are never added together", async () => {
  const storage = memoryStorage();
  const result = await completeChat({
    provider,
    messages: [],
    apiKey: "fake-secret",
    onUsage: (event) => saveUsage(event, storage),
    fetchImpl: async (_, options) => {
      assert.deepEqual(JSON.parse(options.body).stream_options, { include_usage: true });
      return sse(
        { choices: [{ delta: { content: "回答" } }], usage },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage },
        "[DONE]",
      );
    },
  });
  assert.equal(result.usage.total, 125);
  const records = readUsage(storage),
    stats = summarizeUsage(records);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, "success");
  assert.equal(stats.total, 125);
  assert.equal(stats.input, 100);
  assert.equal(stats.output, 25);
  assert.equal(stats.cached, 40);
  assert.ok(!storage.getItem(storage.key(0)).includes("fake-secret"));
});

test("failed, interrupted and retried attempts remain distinct with unknown usage, while reported usage survives an error", async () => {
  const storage = memoryStorage(),
    args = { provider, messages: [], onUsage: (record) => saveUsage(record, storage) };
  await assert.rejects(
    completeChat({ ...args, fetchImpl: async () => new Response("secret", { status: 401 }) }),
  );
  await assert.rejects(
    completeChat({
      ...args,
      fetchImpl: async () =>
        sse(
          { choices: [{ delta: { content: "partial" } }], usage },
          { error: { message: "failure" } },
        ),
    }),
  );
  await completeChat({ ...args, stream: false, fetchImpl: async () => jsonReply() });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    completeChat({
      ...args,
      signal: aborted.signal,
      fetchImpl: async () => {
        throw new DOMException("Aborted", "AbortError");
      },
    }),
  );
  const records = readUsage(storage),
    stats = summarizeUsage(records);
  assert.equal(records.length, 4);
  assert.equal(stats.requests, 4);
  assert.equal(stats.total, 125);
  assert.equal(stats.unknown, 3);
  assert.equal(records[1].usage.total, 125);
  assert.equal(records[3].status, "aborted");
});

test("usage metadata uses the provider at request start and observer failures never break replies", async () => {
  const current = clone(provider),
    records = [];
  await completeChat({
    provider: current,
    messages: [],
    onUsage(record) {
      records.push(record);
      current.model = "changed-during-request";
      throw new Error("storage full");
    },
    fetchImpl: async (_, options) => {
      assert.equal(JSON.parse(options.body).model, "gpt-5.4");
      return jsonReply({ usage });
    },
  });
  assert.ok(records.every((record) => record.model === "gpt-5.4"));
  assert.equal(records.at(-1).status, "success");
});

test("usage records survive independent tab writes and separate connections, URLs and date ranges", () => {
  const storage = memoryStorage(),
    startedAt = "2026-09-24T10:00:00.000Z";
  const row = {
    ...provider,
    providerId: provider.id,
    startedAt,
    updatedAt: startedAt,
    status: "success",
    usage,
  };
  saveUsage({ ...row, id: "tab1", apiKey: "SECRET", messages: ["private text"] }, storage);
  saveUsage({ ...row, id: "tab2", baseUrl: "https://else.example/v1" }, storage);
  saveUsage({ ...row, id: "tab3", startedAt: "2026-08-01T10:00:00.000Z" }, storage);
  assert.equal(readUsage(storage).length, 3);
  assert.equal(
    summarizeUsage(readUsage(storage), {
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      period: "month",
      date: new Date("2026-09-24T10:00:00.000Z"),
    }).total,
    125,
  );
  assert.ok(!storage.getItem(storage.key(0)).includes("SECRET"));
  assert.ok(!storage.getItem(storage.key(0)).includes("private text"));
  assert.equal(normalizeUsage({ total_tokens: -1 }), null);
  assert.equal(normalizeUsage({ prompt_tokens: 0, completion_tokens: 0 }).total, 0);
});

test("model options are constrained per platform and cannot be injected by imports", () => {
  const settings = {
    maxTokens: 4096,
    temperature: 0.7,
    reasoning: "none",
    streaming: true,
    apiKey: "SECRET",
  };
  assert.deepEqual(requestOptions({ ...provider, options: settings }, true), {
    max_completion_tokens: 4096,
    temperature: 0.7,
    reasoning_effort: "none",
    stream_options: { include_usage: true },
  });
  const astra = requestOptions({ ...provider, model: "gpt-6-astra", options: settings }, false);
  assert.ok(!("temperature" in astra));
  assert.ok(!("reasoning_effort" in astra));
  assert.ok(!("stream_options" in astra));
  assert.ok(modelCapabilities({ ...provider, model: "gpt-6-astra" }).reasoning.includes("max"));
  const kimi = requestOptions(
    { ...provider, baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.6", options: settings },
    true,
  );
  assert.deepEqual(kimi.thinking, { type: "disabled" });
  assert.ok(!("temperature" in kimi));
  const custom = requestOptions(
    { ...provider, baseUrl: "https://api.openai.com.evil.example/v1", options: settings },
    true,
  );
  assert.ok(!("stream_options" in custom));
  const state = initialState();
  state.providers = [{ ...provider, options: settings }];
  assert.ok(!JSON.stringify(cleanState(state)).includes("SECRET"));
});

test("old provider options migrate without manufacturing configuration conflicts", () => {
  const old = initialState();
  old.schemaVersion = 2;
  old.providers = [{ ...provider, updatedAt: "2026-09-24T10:00:00.000Z" }];
  const a = cleanState(old),
    b = cleanState(old);
  a.providers[0].options.maxTokens = 8192;
  const result = mergeStates(a, b, old);
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].options.maxTokens, 8192);
});

test("model discovery filters incompatible OpenAI models and sends no tokens in URLs or redirects", async () => {
  const ids = await fetchModels({
    baseUrl: provider.baseUrl,
    apiKey: "fake-secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fake-secret");
      return Response.json({
        data: [
          { id: "gpt-5.4" },
          { id: "gpt-5.4" },
          { id: "gpt-6-astra" },
          { id: "gpt-image-1" },
          { id: "text-embedding-3-small" },
          { id: "gpt-5.4-pro" },
        ],
      });
    },
  });
  assert.deepEqual(ids, ["gpt-5.4", "gpt-6-astra"]);
});

test("balance adapters use official endpoints and preserve account-reported available balances", async () => {
  let calls = 0;
  assert.equal(balanceEndpoint(provider), null);
  await assert.rejects(
    fetchBalance({
      provider,
      apiKey: "fake",
      fetchImpl: async () => {
        calls++;
      },
    }),
  );
  assert.equal(calls, 0);
  const deepseek = { ...provider, baseUrl: "https://api.deepseek.com/v1" };
  const balance = await fetchBalance({
    provider: deepseek,
    apiKey: "fake",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.deepseek.com/user/balance");
      assert.equal(options.redirect, "error");
      return Response.json({
        is_available: true,
        balance_infos: [
          {
            currency: "CNY",
            total_balance: "12.34",
            granted_balance: "2.34",
            topped_up_balance: "10",
          },
        ],
      });
    },
  });
  assert.deepEqual(balance.balances, [{ currency: "CNY", amount: 12.34 }]);
  const kimi = await fetchBalance({
    provider: { ...provider, baseUrl: "https://api.moonshot.ai/v1" },
    apiKey: "fake",
    fetchImpl: async () =>
      Response.json({
        code: 0,
        status: true,
        data: { available_balance: 8.5, voucher_balance: 10, cash_balance: -2 },
      }),
  });
  assert.deepEqual(kimi.balances, [{ currency: "USD", amount: 8.5 }]);
  assert.equal(
    balanceEndpoint({ ...provider, baseUrl: "https://api.deepseek.com.evil.example" }),
    null,
  );
});

test("router invocations are recorded even when routing output needs a fallback", async (context) => {
  const records = [];
  context.mock.method(globalThis, "fetch", async () => jsonReply({ usage }));
  await selectBot({
    text: "hi",
    bots: initialState().bots,
    provider,
    onUsage: (record) => records.push(record),
  });
  assert.equal(records.at(-1).purpose, "router");
  assert.equal(records.at(-1).usage.total, 125);
});
