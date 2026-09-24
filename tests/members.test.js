import test from "node:test";
import assert from "node:assert/strict";
import { summarizeExperience } from "../src/experience.js";
import {
  initialState,
  createConversation,
  cleanState,
  cleanBot,
  mergeStates,
  mergeConversation,
  promptMessages,
  clone,
  VERSION,
} from "../src/data.js";
const member = () => ({
  ...initialState().bots[0],
  id: "writer",
  name: "写作助手",
  prompt: "原人设",
  experience: "原经验",
});
const stateFor = (chat) => ({
  ...initialState(),
  bots: [...initialState().bots, member()],
  conversations: [chat],
});
const msg = (id, content) => ({
  id,
  role: "user",
  content,
  createdAt: "2026-09-24T10:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
  status: "complete",
});

test("session captures the current persona and experience, later edits affect only new sessions", () => {
  const bot = member(),
    old = createConversation(bot);
  old.messages = [msg("u", "你好")];
  bot.prompt = "新的人设";
  bot.experience = "新的经验";
  const fresh = createConversation(bot);
  assert.equal(old.ownerBotId, "writer");
  assert.equal(old.profileSnapshot.prompt, "原人设");
  assert.equal(old.profileSnapshot.experience, "原经验");
  assert.equal(fresh.profileSnapshot.prompt, "新的人设");
  assert.equal(fresh.profileSnapshot.experience, "新的经验");
  assert.match(promptMessages(old, bot, [bot])[0].content, /原人设[\s\S]*原经验/);
  assert.doesNotMatch(promptMessages(old, bot, [bot])[0].content, /新的经验/);
});

test("v1 conversations migrate without inventing historical profile snapshots", () => {
  const old = {
    schemaVersion: 1,
    bots: initialState().bots,
    providers: [],
    conversations: [
      {
        id: "old",
        botId: "former",
        messages: [],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
  };
  const migrated = cleanState(old);
  assert.equal(migrated.schemaVersion, VERSION);
  assert.equal(migrated.conversations[0].ownerBotId, "former");
  assert.equal(migrated.conversations[0].profileSnapshot, null);
  assert.deepEqual(cleanState(migrated), migrated);
});

test("sync preserves a nonempty snapshot against a newer legacy record", () => {
  const a = createConversation(member()),
    b = clone(a);
  b.profileSnapshot = null;
  b.updatedAt = "2099-01-01T00:00:00.000Z";
  assert.deepEqual(mergeConversation(a, b).profileSnapshot, a.profileSnapshot);
});

test("recovered legacy work does not inherit a deleted branch's initialized persona", () => {
  const deleted = createConversation(member()),
    live = clone(deleted);
  deleted.deletedAt = "2099-01-01T00:00:00.000Z";
  live.profileSnapshot = null;
  live.messages = [msg("offline", "旧设备工作")];
  const recovered = mergeStates(stateFor(deleted), stateFor(live)).conversations.find(
    (chat) => !chat.deletedAt,
  );
  assert.equal(recovered.profileSnapshot, null);
});

test("experience drafts summarize the member's replies without mutating saved experience", async (context) => {
  const bot = member(),
    conversation = createConversation(bot);
  conversation.messages = [
    msg("u", "用户偏好"),
    { ...msg("other", "其他成员的结论"), role: "assistant", botId: "other" },
    { ...msg("mine", "本成员的方法"), role: "assistant", botId: bot.id },
  ];
  let request;
  context.mock.method(globalThis, "fetch", async (_, options) => {
    request = JSON.parse(options.body);
    return Response.json({
      choices: [{ message: { content: "新经验草稿" }, finish_reason: "stop" }],
    });
  });
  const draft = await summarizeExperience({
    conversation,
    bot,
    provider: { baseUrl: "https://model.example/v1", model: "test" },
    apiKey: "fake",
  });
  assert.equal(draft, "新经验草稿");
  assert.equal(bot.experience, "原经验");
  assert.equal(request.stream, false);
  assert.match(request.messages[1].content, /本成员的方法/);
  assert.doesNotMatch(request.messages[1].content, /其他成员的结论/);
});

test("recovering offline work retains the live persona rather than the deleted profile", () => {
  const deleted = createConversation(member()),
    live = clone(deleted);
  deleted.deletedAt = "2099-01-01T00:00:00.000Z";
  deleted.messages = [msg("a", "被删除分支的消息")];
  live.profileSnapshot.prompt = "离线使用的人设";
  live.messages = [msg("b", "离线工作")];
  const merged = mergeStates(stateFor(deleted), stateFor(live));
  const recovered = merged.conversations.find((chat) => !chat.deletedAt);
  assert.equal(recovered.profileSnapshot.prompt, "离线使用的人设");
  assert.deepEqual(
    recovered.messages.map((message) => message.id),
    ["b"],
  );
});

test("different concurrent persona snapshots produce stable separate conversation branches", () => {
  const a = createConversation(member()),
    b = clone(a);
  a.messages = [msg("a", "使用原人设")];
  b.messages = [msg("b", "使用另一人设")];
  b.profileSnapshot.prompt = "另一人设";
  const merged = mergeStates(stateFor(a), stateFor(b));
  assert.equal(merged.conversations.length, 2);
  assert.ok(merged.conversations.every((chat) => chat.messages.length === 1));
  assert.deepEqual(mergeStates(merged, stateFor(b)), merged);
  assert.deepEqual(mergeStates(stateFor(b), stateFor(a)), merged);
});

test("avatars accept only bounded embedded raster images and are retained with experience", () => {
  const avatarData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkXcAAAAASUVORK5CYII=";
  const bot = cleanBot({ ...member(), avatarData });
  assert.equal(bot.avatarData, avatarData);
  assert.equal(bot.experience, "原经验");
  for (const value of [
    "https://tracking.example/avatar.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64," + "A".repeat(16001),
  ])
    assert.equal(cleanBot({ ...bot, avatarData: value }).avatarData, "");
});

test("handoff context includes the current question only once and uses the target snapshot", () => {
  const target = createConversation(member());
  target.handoffContext = [msg("old", "旧问题")];
  target.messages = [msg("new", "新问题")];
  const messages = promptMessages(target, member(), [member()]);
  assert.equal(messages.filter((item) => item.content === "新问题").length, 1);
  assert.equal(messages.filter((item) => item.content === "旧问题").length, 1);
  assert.match(messages[0].content, /原人设/);
});
