import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { initialState, createConversation } from "../../src/data.js";

async function openSettings(page) {
  if (await page.getByRole("button", { name: "打开角色和历史对话", exact: true }).isVisible())
    await page.getByRole("button", { name: "打开角色和历史对话", exact: true }).click();
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
}
async function closeDialog(page) {
  await page.getByRole("button", { name: "关闭", exact: true }).click();
}
async function addModel(page) {
  await openSettings(page);
  await page.getByLabel("连接名称", { exact: true }).fill("我的测试模型");
  await page.getByLabel("模型名称", { exact: true }).fill("test-model");
  await page.getByLabel("接口地址（Base URL）", { exact: true }).fill("https://model.example/v1");
  await page.getByLabel("API Key", { exact: true }).fill("fake-model-secret");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("我的测试模型", { exact: true }).first(),
  ).toBeVisible();
  await closeDialog(page);
  if (await page.getByRole("button", { name: "关闭侧栏", exact: true }).isVisible())
    await page.getByRole("button", { name: "关闭侧栏", exact: true }).click();
}
async function send(page, text) {
  await page.getByRole("textbox", { name: "输入消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
}
async function addRole(page, name, keywords) {
  const menu = page.getByRole("button", { name: "打开角色和历史对话", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByLabel("角色名称", { exact: true }).fill(name);
  await page.getByLabel("角色指令", { exact: true }).fill(`你是${name}，协助用户完成任务。`);
  await page.getByLabel("擅长的关键词", { exact: true }).fill(keywords);
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  const close = page.getByRole("button", { name: "关闭侧栏", exact: true });
  if (await close.isVisible())
    await close.click({ position: { x: page.viewportSize().width - 12, y: 20 } });
}
const reply = (content) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

test("records recovered from another tab remain on disk after reload", async ({ page }) => {
  await page.goto("/");
  const first = initialState(),
    second = initialState();
  first.conversations = [{ ...createConversation("level"), id: "tab-a", title: "标签 A" }];
  second.conversations = [{ ...createConversation("system"), id: "tab-b", title: "标签 B" }];
  for (const data of [first, second]) {
    const chat = data.conversations[0];
    chat.messages = [
      {
        id: `${chat.id}-message`,
        role: "user",
        content: chat.title,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        status: "complete",
      },
    ];
  }
  await page.evaluate(
    (data) => localStorage.setItem("ai-studio:data:v1", JSON.stringify(data)),
    first,
  );
  await page.reload();
  await page.evaluate((data) => {
    const key = "ai-studio:data:v1";
    const oldValue = localStorage.getItem(key),
      newValue = JSON.stringify(data);
    localStorage.setItem(key, newValue);
    dispatchEvent(
      new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }),
    );
  }, second);
  const ids = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ai-studio:data:v1"))
      .conversations.map((chat) => chat.id)
      .sort(),
  );
  expect(ids).toEqual(["tab-a", "tab-b"]);
  await page.reload();
  await expect(page.locator(".history-item")).toHaveCount(2);
});

test("responsive workspace, configuration, routing, continuation and secret-free backup", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  await page.route("https://model.example/**", async (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    await route.fulfill({
      contentType: "text/event-stream",
      body: reply("这是一个**可执行方案**。\n\n- 先明确目标\n- 再设计体验"),
    });
  });
  await page.goto("/");
  await expect(page).toHaveTitle("AI Bot");
  await expect(page.locator(".bot-nav")).toHaveCount(1);
  await expect(page.locator(".bot-nav")).toContainText("管家");
  await expect(page.locator(".chat-area")).toBeEmpty();
  await expect(page.locator(".suggestions, .welcome, .profile, .composer-hint")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.local/${info.project.name}-home.png`, fullPage: true });
  await addModel(page);
  await addRole(page, "关卡策划", "关卡,探索");
  await addRole(page, "系统策划", "系统,奖励");
  await send(page, "帮我设计一个探索关卡");
  await expect(page.locator(".assistant-message .message-content")).toContainText("可执行方案");
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
  expect(requests[0].messages[0].content).toContain("关卡策划");
  await send(page, "请交给系统策划，设计奖励系统");
  await expect(page.locator(".assistant-message")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
  expect(requests[1].messages[0].content).toContain("系统策划");
  expect(requests[1].messages.some((m) => m.content.includes("可执行方案"))).toBe(true);
  await page.screenshot({ path: `.local/${info.project.name}-chat.png`, fullPage: true });
  await openSettings(page);
  await page.getByRole("tab", { name: "数据与备份" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const download = await downloadPromise;
  const exported = await readFile(await download.path(), "utf8");
  expect(exported).toContain("探索关卡");
  expect(exported).not.toContain("fake-model-secret");
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).not.toContain("fake-model-secret");
  await closeDialog(page);
  await page.reload();
  await expect(page.locator(".user-message")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("custom role creation and editing persists after reload", async ({ page }) => {
  await page.goto("/");
  if (await page.getByRole("button", { name: "打开角色和历史对话" }).isVisible())
    await page.getByRole("button", { name: "打开角色和历史对话" }).click();
  await page.getByRole("button", { name: "添加角色", exact: true }).click();
  await page.getByLabel("角色名称", { exact: true }).fill("叙事策划");
  await page.getByLabel("一句话职责", { exact: true }).fill("剧情与世界观");
  await page.getByLabel("角色指令", { exact: true }).fill("你负责叙事设计，清楚区分设定与假设。");
  await page.getByLabel("擅长的关键词", { exact: true }).fill("剧情,对白");
  await page.getByRole("button", { name: "保存角色" }).click();
  await page.reload();
  if (await page.getByRole("button", { name: "打开角色和历史对话" }).isVisible())
    await page.getByRole("button", { name: "打开角色和历史对话" }).click();
  await expect(page.locator(".bot-nav").filter({ hasText: "叙事策划" })).toBeVisible();
  await page.getByRole("button", { name: "编辑叙事策划", exact: true }).click();
  await expect(page.getByLabel("角色指令", { exact: true })).toHaveValue(
    "你负责叙事设计，清楚区分设定与假设。",
  );
});

test("retry does not duplicate user messages and invalid credentials are understandable", async ({
  page,
}) => {
  let count = 0;
  await page.route("https://model.example/**", async (route) => {
    count++;
    await route.fulfill(
      count === 1
        ? { status: 401, body: "upstream-private-details" }
        : { contentType: "text/event-stream", body: reply("恢复正常") },
    );
  });
  await page.goto("/");
  await addModel(page);
  await send(page, "设计一个关卡");
  await expect(page.getByText("模型密钥无效或已过期，请重新填写", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试回答", exact: true }).click();
  await expect(page.locator(".assistant-message .message-content").last()).toContainText(
    "恢复正常",
  );
  await expect(page.locator(".user-message")).toHaveCount(1);
});

test("private repository sync excludes credentials and is usable on another device", async ({
  page,
  browser,
}) => {
  const remote = new Map(),
    writes = [];
  let sha = 0;
  const handler = async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = decodeURIComponent(url.pathname.replace("/repos/test-user/private-data", ""));
    if (!path) return route.fulfill({ json: { private: true, default_branch: "main" } });
    const filename = path.replace("/contents/", "");
    if (req.method() === "PUT") {
      const body = req.postDataJSON();
      const text = Buffer.from(body.content, "base64").toString("utf8");
      writes.push(text);
      remote.set(filename, { sha: String(++sha), text });
      return route.fulfill({ json: { content: { sha: String(sha) } } });
    }
    const file = remote.get(filename);
    if (file)
      return route.fulfill({
        json: {
          type: "file",
          encoding: "base64",
          sha: file.sha,
          size: Buffer.byteLength(file.text),
          content: Buffer.from(file.text).toString("base64"),
        },
      });
    const files = [...remote]
      .filter(([key]) => key.startsWith(filename + "/"))
      .map(([key, file]) => ({ path: key, sha: file.sha, type: "file" }));
    return files.length
      ? route.fulfill({ json: files })
      : route.fulfill({ status: 404, json: { message: "not found" } });
  };
  await page.route("https://api.github.com/**", handler);
  await page.route("https://model.example/**", (route) =>
    route.fulfill({ contentType: "text/event-stream", body: reply("跨设备保留的回答") }),
  );
  await page.goto("/");
  await addModel(page);
  await send(page, "设计探索关卡");
  await expect(page.locator(".assistant-message")).toContainText("跨设备保留的回答");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await openSettings(page);
  await page.getByRole("tab", { name: "GitHub 同步" }).click();
  await page.getByLabel("数据仓库", { exact: true }).fill("test-user/private-data");
  await page.getByLabel("GitHub 访问令牌", { exact: true }).fill("fake-github-secret");
  await page.getByRole("button", { name: "连接并同步" }).click();
  await expect.poll(() => writes.length).toBeGreaterThan(1);
  expect(writes.join("")).not.toContain("fake-model-secret");
  expect(writes.join("")).not.toContain("fake-github-secret");
  expect(writes.join("")).toContain("跨设备保留的回答");
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.route("https://api.github.com/**", handler);
  await other.goto("http://127.0.0.1:4173/");
  await other.getByRole("button", { name: "连接 GitHub", exact: true }).click();
  await other.getByLabel("数据仓库", { exact: true }).fill("test-user/private-data");
  await other.getByLabel("GitHub 访问令牌", { exact: true }).fill("fake-github-secret");
  await other.getByRole("button", { name: "连接并同步" }).click();
  await expect(other.locator(".history-item")).toHaveCount(1);
  if (await other.getByRole("button", { name: "打开角色和历史对话" }).isVisible())
    await other.getByRole("button", { name: "打开角色和历史对话" }).click();
  await other.locator(".history-item>button").first().click();
  await expect(other.locator(".assistant-message")).toContainText("跨设备保留的回答");
  await context.close();
});

test("imported markup and malicious timestamps cannot execute scripts", async ({ page }) => {
  await page.goto("/");
  await openSettings(page);
  await page.getByRole("tab", { name: "数据与备份" }).click();
  const data = initialState(),
    chat = createConversation("level");
  chat.messages = [
    {
      id: "unsafe",
      role: "assistant",
      content: '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>安全正文',
      createdAt: '2026-01-01 (\"><img src=x onerror=window.pwned=true>)',
      updatedAt: "2026-01-01",
      status: "complete",
      botId: "level",
    },
  ];
  data.conversations = [chat];
  await page.locator("#import-file").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await closeDialog(page);
  if (await page.getByRole("button", { name: "打开角色和历史对话" }).isVisible())
    await page.getByRole("button", { name: "打开角色和历史对话" }).click();
  await page.locator(".history-item>button").first().click();
  await expect(page.locator(".message-content")).toContainText("安全正文");
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await expect(page.locator(".message img,.message script,[onerror]")).toHaveCount(0);
});
