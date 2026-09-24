import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initialState,
  cleanState,
  cleanMessage,
  createConversation,
  mergeStates,
  promptMessages,
  routeByKeywords,
  clone,
} from "../src/data.js";
const time = "2026-09-24T10:00:00.000Z";
const legacyState = () =>
  JSON.parse(readFileSync(new URL("./fixtures/legacy-state.json", import.meta.url), "utf8"));
function configuredState() {
  const state = initialState(),
    template = state.bots[0];
  state.bots.push(
    { ...template, id: "level", name: "关卡策划", keywords: "关卡,探索", prompt: "你负责关卡设计" },
    {
      ...template,
      id: "system",
      name: "系统策划",
      keywords: "系统,奖励",
      prompt: "你负责系统设计",
    },
  );
  return state;
}

test("new workspace contains only the personal butler", () => {
  assert.deepEqual(
    initialState().bots.map((bot) => bot.id),
    ["butler"],
  );
  assert.ok(!initialState().bots[0].prompt.includes("策划"));
});

test("legacy cleanup preserves customized roles, models and conversation history", () => {
  const old = legacyState();
  old.bots.find((bot) => bot.id === "level").updatedAt = "2099-01-01T00:00:00.000Z";
  old.bots.find((bot) => bot.id === "system").prompt = "用户自己写的指令";
  old.bots.find((bot) => bot.id === "balance").providerId = "model";
  old.bots.push({ ...old.bots[1], id: "my-custom-bot" });
  old.providers = [
    {
      id: "model",
      name: "模型",
      baseUrl: "https://example.com/v1",
      model: "test",
      updatedAt: time,
      deletedAt: null,
    },
  ];
  old.conversations = sample().conversations;
  const cleaned = cleanState(old);
  assert.deepEqual(
    cleaned.bots.map((bot) => bot.id),
    ["butler", "system", "balance", "my-custom-bot"],
  );
  assert.deepEqual(cleaned.providers, old.providers);
  assert.deepEqual(cleaned.conversations, old.conversations);
  assert.equal(cleaned.bots[0].prompt, initialState().bots[0].prompt);
  assert.deepEqual(cleanState(cleaned), cleaned);
});

test("old defaults cannot return through sync or overwrite customized remote roles", () => {
  const old = legacyState(),
    remote = legacyState();
  old.bots[1].updatedAt = "2099-01-01T00:00:00.000Z";
  remote.bots[1].prompt = "保留我的自定义指令";
  const merged = mergeStates(old, remote, legacyState());
  assert.equal(merged.bots.find((bot) => bot.id === "level").prompt, "保留我的自定义指令");
  assert.equal(merged.bots.length, 2);
  assert.deepEqual(mergeStates(merged, old), merged);
  const deleted = legacyState();
  deleted.bots[2].deletedAt = time;
  assert.equal(cleanState(deleted).bots.find((bot) => bot.id === "system").deletedAt, time);
});
const message = (id, content, role = "user") => ({
  id,
  content,
  role,
  botId: "level",
  botName: "关卡策划",
  replyTo: "",
  createdAt: time,
  updatedAt: time,
  status: "complete",
  error: "",
});
function sample() {
  const state = configuredState();
  const chat = createConversation("level");
  chat.id = "chat-1";
  chat.messages = [message("first", "开始")];
  state.conversations = [chat];
  return state;
}

test("two devices append without losing either message and repeated merge is idempotent", () => {
  const a = sample(),
    b = clone(a);
  a.conversations[0].messages.push(message("from-a", "电脑"));
  b.conversations[0].messages.push(message("from-b", "手机"));
  const merged = mergeStates(a, b);
  assert.equal(merged.conversations[0].messages.length, 3);
  assert.deepEqual(mergeStates(merged, b), merged);
});
test("deletion does not resurrect, while offline new messages get a recovery conversation", () => {
  const a = sample(),
    b = clone(a);
  a.conversations[0].deletedAt = time;
  b.conversations[0].messages.push(message("offline", "离线新消息"));
  const merged = mergeStates(a, b);
  assert.ok(merged.conversations.find((c) => c.id === "chat-1").deletedAt);
  const restored = merged.conversations.find((c) => !c.deletedAt);
  assert.ok(restored.title.includes("恢复"));
  assert.ok(restored.messages.some((m) => m.id === "offline"));
  assert.deepEqual(mergeStates(merged, b), merged);
});
test("one-sided bot edit survives a slow device clock", () => {
  const base = configuredState();
  base.bots[1].updatedAt = time;
  const a = clone(base),
    b = clone(base);
  a.bots[1].name = "新名字";
  a.bots[1].updatedAt = "2026-09-24T09:59:00.000Z";
  assert.equal(mergeStates(a, b, base).bots.find((bot) => bot.id === "level").name, "新名字");
});
test("concurrent role edits retain a conflict copy", () => {
  const base = configuredState(),
    a = clone(base),
    b = clone(base);
  a.bots[1].prompt = "电脑指令";
  b.bots[1].prompt = "手机指令";
  const result = mergeStates(a, b, base);
  assert.ok(result.bots.some((bot) => bot.prompt === "电脑指令"));
  assert.ok(result.bots.some((bot) => bot.prompt === "手机指令"));
});
test("credentials and unknown properties cannot enter export or sync payloads", () => {
  const state = sample();
  state.githubToken = "SECRET";
  state.apiKey = "SECRET";
  state.bots[0].secret = "SECRET";
  state.providers.push({
    id: "model",
    name: "模型",
    model: "test",
    baseUrl: "https://example.com/v1",
    apiKey: "SECRET",
    updatedAt: time,
  });
  state.conversations[0].messages[0].authorization = "SECRET";
  assert.ok(!JSON.stringify(cleanState(state)).includes("SECRET"));
});
test("dates are canonicalized before being rendered in HTML", () => {
  const data = cleanMessage({
    ...message("safe", "正文"),
    createdAt: '2026-01-01 (\"><img src=x onerror=alert(1)>)',
  });
  assert.match(data.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!data.createdAt.includes("<"));
});
test("long messages are preserved, not silently truncated", () => {
  const content = "字".repeat(200017);
  assert.equal(cleanMessage(message("long", content)).content.length, content.length);
});
test("invalid backup versions fail without changing original", () => {
  const state = sample(),
    original = clone(state);
  assert.throws(() => cleanState({ ...state, schemaVersion: 99 }));
  assert.deepEqual(state, original);
});
test("explicit positive routing beats negated role mention and followups keep role", () => {
  const bots = configuredState().bots;
  assert.equal(routeByKeywords("不要找关卡策划，请交给系统策划", bots, "level"), "system");
  assert.equal(routeByKeywords("继续展开", bots, "level"), "level");
  assert.equal(routeByKeywords("再设计一下奖励系统", bots, "level"), "system");
});
test("truncated response remains available for continuation and handoff", () => {
  const state = sample(),
    chat = state.conversations[0];
  chat.messages.push({
    ...message("reply", "前半段设计", "assistant"),
    status: "length",
    replyTo: "first",
  });
  chat.messages.push(message("next", "继续"));
  const context = promptMessages(chat, state.bots[2], state.bots);
  assert.ok(context.some((m) => m.content.includes("前半段设计")));
  assert.ok(context.some((m) => m.content.includes("此前由关卡策划回答")));
});
