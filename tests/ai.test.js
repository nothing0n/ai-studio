import test from "node:test";
import assert from "node:assert/strict";
import { completeChat, sseEvents, selectBot, fetchModels } from "../src/ai.js";
const provider = { baseUrl: "https://model.example/v1", model: "test" };
function streamResponse(text, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize)
          controller.enqueue(bytes.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const event = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
test("SSE parses every-byte UTF-8, CRLF, role-only deltas, usage, and completion", async () => {
  const stream =
    ": heartbeat\r\n\r\n" +
    event({ choices: [{ delta: { role: "assistant" } }] }) +
    event({ choices: [{ delta: { content: "你好🙂" } }] }) +
    event({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
    event({ choices: [], usage: { total_tokens: 10 } }) +
    "data: [DONE]\r\n\r\n";
  let received = "";
  const result = await completeChat({
    provider,
    messages: [],
    fetchImpl: async () => streamResponse(stream),
    onDelta: (delta) => (received += delta),
  });
  assert.equal(received, "你好🙂");
  assert.equal(result.content, received);
  assert.equal(result.finishReason, "stop");
});
test("SSE multiline data and several events in one network read", async () => {
  const values = [];
  for await (const event of sseEvents(
    streamResponse("data: first\ndata: second\n\ndata: third\n\n", 999).body,
  ))
    values.push(event);
  assert.deepEqual(values, ["first\nsecond", "third"]);
});
test("premature EOF keeps received text but raises an interruption", async () => {
  let received = "";
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      fetchImpl: async () =>
        streamResponse(event({ choices: [{ delta: { content: "保留内容" } }] })),
      onDelta: (d) => (received += d),
    }),
    /提前中断/,
  );
  assert.equal(received, "保留内容");
});
test("provider stream errors and malformed JSON are surfaced", async () => {
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      fetchImpl: async () =>
        streamResponse(event({ error: { message: "private upstream detail" } })),
    }),
    /返回错误/,
  );
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      fetchImpl: async () => streamResponse("data: bad json\n\n"),
    }),
    /不完整/,
  );
});
test("HTTP errors do not expose upstream secrets", async () => {
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      fetchImpl: async () => new Response("SECRET", { status: 401 }),
    }),
    (error) => error.message.includes("密钥") && !error.message.includes("SECRET"),
  );
});
test("429 errors distinguish billing limits from rate limits without exposing provider messages", async () => {
  const cases = [
    [{ code: "credit_balance_exhausted", type: "insufficient_quota" }, /预付余额已耗尽/],
    [{ code: "project_spend_limit_exceeded", type: "insufficient_quota" }, /项目已达到支出上限/],
    [{ code: "organization_spend_limit_exceeded" }, /组织已达到支出上限/],
    [{ code: "organization_usage_limit_exceeded" }, /平台分配的用量上限/],
    [{ code: "insufficient_quota", type: "rate_limit_error" }, /连续重试无法解决/],
    [{ code: "rate_limit_exceeded", type: "insufficient_quota" }, /速率达到上限/],
    [{ code: "slow_down" }, /临时限流/],
    [{ code: "unknown", type: "insufficient_quota" }, /API 可用额度不足/],
    [{ type: "rate_limit_error" }, /速率达到上限/],
    [{ code: "toString", type: "unknown" }, /未说明具体原因/],
    [{}, /未说明具体原因/],
  ];
  for (const [error, expected] of cases) {
    const fetchImpl = async () =>
      Response.json({ error: { ...error, message: "CANARY_FAKE_KEY" } }, { status: 429 });
    for (const call of [
      () => completeChat({ provider, messages: [], fetchImpl }),
      () => fetchModels({ baseUrl: provider.baseUrl, fetchImpl }),
    ])
      await assert.rejects(
        call(),
        (result) => expected.test(result.message) && !result.message.includes("CANARY"),
      );
  }
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      fetchImpl: async () =>
        new Response("CANARY_FAKE_KEY", {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error) => error.message.includes("未说明具体原因") && !error.message.includes("CANARY"),
  );
});
test("invalid JSON cannot expose response excerpts in chat or model-discovery errors", async () => {
  const fetchImpl = async () =>
    new Response("CANARY_FAKE_KEY_123", {
      headers: { "Content-Type": "application/json" },
    });
  for (const call of [
    () => completeChat({ provider, messages: [], fetchImpl }),
    () => fetchModels({ baseUrl: provider.baseUrl, fetchImpl }),
  ]) {
    await assert.rejects(
      call(),
      (error) => error.message.includes("格式不正确") && !error.message.includes("CANARY"),
    );
  }
});
test("compatible JSON response and length finish reason are accepted", async () => {
  const result = await completeChat({
    provider,
    messages: [],
    fetchImpl: async () =>
      Response.json({ choices: [{ message: { content: "半个回答" }, finish_reason: "length" }] }),
  });
  assert.equal(result.finishReason, "length");
  assert.equal(result.content, "半个回答");
});
test("request uses caller abort signal and does not follow redirects", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    completeChat({
      provider,
      messages: [],
      signal: controller.signal,
      fetchImpl: async (url, options) => {
        assert.equal(options.redirect, "error");
        assert.equal(options.signal, controller.signal);
        throw new DOMException("aborted", "AbortError");
      },
    }),
    { name: "AbortError" },
  );
});
