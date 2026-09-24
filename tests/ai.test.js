import test from "node:test";
import assert from "node:assert/strict";
import { completeChat, sseEvents, selectBot } from "../src/ai.js";
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
