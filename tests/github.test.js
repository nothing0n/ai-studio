import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GitHubStore, utf8Base64, base64Utf8 } from "../src/github.js";
import { initialState, createConversation, clone } from "../src/data.js";
const configPath = "studio-data/settings.json";
function remoteServer() {
  const files = new Map();
  let version = 0;
  const server = { files, private: true, beforeWrite: null, writes: [] };
  server.set = (path, data) => files.set(path, { sha: String(++version), data: clone(data) });
  server.fetch = async (url, options = {}) => {
    assert.ok(url.startsWith("https://api.github.com/repos/test/data"));
    const path = decodeURIComponent(new URL(url).pathname.replace("/repos/test/data", ""));
    if (!path) return Response.json({ private: server.private, default_branch: "main" });
    if (!path.startsWith("/contents/")) return Response.json({}, { status: 404 });
    const filePath = path.slice("/contents/".length);
    if (options.method === "PUT") {
      if (server.beforeWrite) {
        const fn = server.beforeWrite;
        server.beforeWrite = null;
        fn(filePath);
      }
      const body = JSON.parse(options.body),
        file = files.get(filePath);
      if ((file && file.sha !== body.sha) || (!file && body.sha))
        return Response.json({}, { status: 409 });
      const data = JSON.parse(base64Utf8(body.content));
      server.set(filePath, data);
      server.writes.push({ path: filePath, body });
      return Response.json({ content: { sha: files.get(filePath).sha } }, { status: 201 });
    }
    const file = files.get(filePath);
    if (file) {
      const json = JSON.stringify(file.data);
      return Response.json({
        type: "file",
        encoding: "base64",
        size: new TextEncoder().encode(json).length,
        sha: file.sha,
        content: utf8Base64(json),
      });
    }
    const entries = [...files]
      .filter(([key]) => key.startsWith(filePath + "/"))
      .map(([key, file]) => ({ path: key, type: "file", sha: file.sha }));
    return entries.length ? Response.json(entries) : Response.json({}, { status: 404 });
  };
  return server;
}
const store = (server, cache = {}) =>
  new GitHubStore({
    repository: "test/data",
    token: "fake-github-secret",
    fetchImpl: server.fetch,
    cache,
  });
function stateWithChat() {
  const state = initialState(),
    chat = createConversation("level");
  chat.id = "one";
  chat.messages = [
    {
      id: "m1",
      role: "user",
      content: "中文🙂",
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      status: "complete",
    },
  ];
  state.conversations.push(chat);
  return state;
}
test("empty private repository can be initialized without a branch or existing SHA", async () => {
  const server = remoteServer();
  const result = await store(server).sync(stateWithChat());
  assert.equal(result.state.conversations[0].messages[0].content, "中文🙂");
  assert.ok(server.files.has(configPath));
  assert.ok(server.files.has("studio-data/conversations/one.json"));
  for (const write of server.writes) {
    assert.ok(!write.body.sha);
    assert.ok(!("branch" in write.body));
    assert.ok(!JSON.stringify(write.body).includes("fake-github-secret"));
  }
});
test("public data repositories are rejected before any writes", async () => {
  const server = remoteServer();
  server.private = false;
  await assert.rejects(store(server).sync(initialState()), /私有仓库/);
  assert.equal(server.writes.length, 0);
});

test("legacy repository settings are migrated once and stale presets never return", async () => {
  const server = remoteServer();
  const old = JSON.parse(
    readFileSync(new URL("./fixtures/legacy-state.json", import.meta.url), "utf8"),
  );
  const config = { schemaVersion: old.schemaVersion, bots: old.bots, providers: old.providers };
  server.set(configPath, config);
  const cache = { [configPath]: clone(server.files.get(configPath)) };
  const first = await store(server, cache).sync(initialState());
  assert.deepEqual(
    first.state.bots.map((bot) => bot.id),
    ["butler"],
  );
  assert.equal(server.files.get(configPath).data.bots.length, 1);
  const writes = server.writes.length;
  const second = await store(server, first.cache).sync(first.state);
  assert.equal(server.writes.length, writes);
  server.set(configPath, config);
  const third = await store(server, second.cache).sync(second.state);
  assert.deepEqual(
    third.state.bots.map((bot) => bot.id),
    ["butler"],
  );
  assert.equal(server.files.get(configPath).data.bots.length, 1);
});
test("two devices synchronize appended messages, and unchanged sync does not commit", async () => {
  const server = remoteServer(),
    a = stateWithChat();
  const first = await store(server).sync(a);
  const b = clone(first.state);
  a.conversations[0].messages.push({ ...a.conversations[0].messages[0], id: "a", content: "电脑" });
  b.conversations[0].messages.push({ ...b.conversations[0].messages[0], id: "b", content: "手机" });
  await store(server, clone(first.cache)).sync(a);
  const merged = await store(server, clone(first.cache)).sync(b);
  assert.equal(merged.state.conversations[0].messages.length, 3);
  const writes = server.writes.length;
  await store(server, merged.cache).sync(merged.state);
  assert.equal(server.writes.length, writes);
});
test("concurrent repository write retries with fresh SHA and merges contents", async () => {
  const server = remoteServer(),
    a = stateWithChat();
  const first = await store(server).sync(a);
  a.conversations[0].messages.push({
    ...a.conversations[0].messages[0],
    id: "local",
    content: "本机",
  });
  server.beforeWrite = (path) => {
    if (path.endsWith("one.json")) {
      const remote = clone(server.files.get(path).data);
      remote.messages.push({ ...remote.messages[0], id: "remote", content: "远端" });
      server.set(path, remote);
    }
  };
  const result = await store(server, first.cache).sync(a);
  assert.ok(result.state.conversations[0].messages.some((m) => m.id === "remote"));
  assert.ok(result.state.conversations[0].messages.some((m) => m.id === "local"));
});
test("deletion racing with upload produces a persisted recovery copy", async () => {
  const server = remoteServer(),
    a = stateWithChat();
  const first = await store(server).sync(a);
  a.conversations[0].messages.push({
    ...a.conversations[0].messages[0],
    id: "offline",
    content: "还没同步的新消息",
  });
  server.beforeWrite = (path) => {
    const remote = clone(server.files.get(path).data);
    remote.deletedAt = new Date().toISOString();
    server.set(path, remote);
  };
  const result = await store(server, first.cache).sync(a);
  const recovered = result.state.conversations.find((c) => !c.deletedAt);
  assert.ok(recovered && recovered.id.startsWith("recovery_"));
  assert.ok(server.files.has(`studio-data/conversations/${recovered.id}.json`));
});

test("a conflict copy changed during an original-file retry is uploaded again", async () => {
  const server = remoteServer(),
    state = initialState();
  const bot = { ...state.bots[0], id: "member", name: "成员", prompt: "A" };
  state.bots.push(bot);
  const local = createConversation(bot);
  local.id = "shared";
  local.messages = [
    {
      id: "base",
      role: "user",
      content: "共同历史",
      createdAt: "2026-09-24T01:00:00.000Z",
      updatedAt: "2026-09-24T01:00:00.000Z",
      status: "complete",
    },
  ];
  state.conversations = [local];
  const remote = clone(local);
  remote.profileSnapshot.prompt = "B";
  const originalPath = "studio-data/conversations/shared.json";
  server.set(configPath, {
    schemaVersion: state.schemaVersion,
    bots: state.bots,
    providers: state.providers,
  });
  server.set(originalPath, remote);
  let raced = false;
  function injectConcurrentWrite(path) {
    if (path !== originalPath) {
      server.beforeWrite = injectConcurrentWrite;
      return;
    }
    const latest = clone(server.files.get(path).data);
    latest.messages.push({
      ...latest.messages[0],
      id: "remote-race",
      content: "B 人设在并发写入时新增的消息",
    });
    server.set(path, latest);
    raced = true;
  }
  server.beforeWrite = injectConcurrentWrite;
  const result = await store(server).sync(state);
  assert.ok(raced);
  const copy = result.state.conversations.find((chat) => chat.profileSnapshot?.prompt === "B");
  assert.ok(copy);
  const copyPath = `studio-data/conversations/${copy.id}.json`;
  assert.ok(
    server.files.get(copyPath).data.messages.some((message) => message.id === "remote-race"),
  );
  assert.equal(server.writes.filter((write) => write.path === copyPath).length, 2);
  assert.equal(server.files.get(originalPath).data.profileSnapshot.prompt, "A");
  const writeCount = server.writes.length;
  await store(server, result.cache).sync(result.state);
  assert.equal(server.writes.length, writeCount);
});
