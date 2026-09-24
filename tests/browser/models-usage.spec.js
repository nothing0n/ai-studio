import { test, expect } from "@playwright/test";
async function settings(page) {
  const menu = page.getByRole("button", { name: "打开角色和历史对话", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
}
async function close(page) {
  await page.getByRole("button", { name: "关闭", exact: true }).click();
}
async function send(page, text) {
  await page.getByRole("textbox", { name: "输入消息" }).fill(text);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeVisible();
}
const streamReply = (content, usage) =>
  [
    { choices: [{ delta: { content } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage },
  ]
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("") + "data: [DONE]\n\n";

test("platforms, models and parameters use dropdowns while usage remains visible above scrolling chat", async ({
  page,
}, info) => {
  const requests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://api.openai.com/**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer fake-openai-key");
    if (route.request().url().endsWith("/models"))
      return route.fulfill({
        json: {
          data: [
            { id: "gpt-5.4" },
            { id: "gpt-6-astra" },
            { id: "gpt-image-1" },
            { id: "text-embedding-3-small" },
          ],
        },
      });
    expect(route.request().url()).toBe("https://api.openai.com/v1/chat/completions");
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "text/event-stream",
      body: streamReply("这是模型回答。\n\n".repeat(35), {
        prompt_tokens: 700,
        completion_tokens: 100,
        total_tokens: 800,
      }),
    });
  });
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "账户余额与本网页用量" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("普通密钥无法直接查询余额");
  await expect(panel.locator("[data-balance-value]")).toHaveText("—");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settings(page);
  await expect(page.getByLabel("模型平台", { exact: true })).toHaveValue("openai");
  expect(await page.getByLabel("模型名称", { exact: true }).evaluate((el) => el.tagName)).toBe(
    "SELECT",
  );
  expect(
    await page.getByLabel("接口地址（Base URL）", { exact: true }).evaluate((el) => el.tagName),
  ).toBe("SELECT");
  await page.getByLabel("API Key", { exact: true }).fill("fake-openai-key");
  await page.getByRole("button", { name: "读取可用模型", exact: true }).click();
  await expect(page.locator("#model-discovery-status")).toContainText("已读取 2 个模型");
  await expect(page.getByLabel("模型名称", { exact: true }).locator("option")).toHaveCount(3);
  await page.locator(".model-advanced summary").click();
  await page.getByLabel("模型名称", { exact: true }).selectOption("gpt-6-astra");
  await expect(page.getByLabel("回答随机性", { exact: true })).toBeDisabled();
  await expect(
    page.getByLabel("思考程度", { exact: true }).locator('option[value="none"]'),
  ).toHaveCount(0);
  await page.getByLabel("模型名称", { exact: true }).selectOption("gpt-5.4");
  await page.getByLabel("思考程度", { exact: true }).selectOption("none");
  await page.getByLabel("回答随机性", { exact: true }).selectOption("0.7");
  await page.getByLabel("生成 Token 上限", { exact: true }).selectOption("4096");
  await page.screenshot({
    path: `.local/${info.project.name}-model-dropdowns.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await close(page);
  await send(page, "你好");
  await expect(page.locator(".assistant-message")).toContainText("这是模型回答");
  await expect(panel.locator("[data-usage-total]")).toHaveText("800 Token");
  await expect(panel).toContainText("输入 700 · 输出 100");
  await expect(panel).toContainText("1 次请求");
  expect(requests[0]).toMatchObject({
    model: "gpt-5.4",
    reasoning_effort: "none",
    temperature: 0.7,
    max_completion_tokens: 4096,
    stream_options: { include_usage: true },
  });
  const before = await panel.boundingBox();
  await page.locator(".chat-area").evaluate((el) => {
    el.scrollTop = 0;
  });
  const after = await panel.boundingBox();
  expect(after.y).toBe(before.y);
  expect(after.y + after.height).toBeLessThan(page.viewportSize().height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.local/${info.project.name}-usage-panel.png`, fullPage: true });
  await page.reload();
  await expect(panel.locator("[data-usage-total]")).toHaveText("800 Token");
  await settings(page);
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("fake-openai-key");
  await page.locator(".model-advanced summary").click();
  await expect(page.getByLabel("思考程度", { exact: true })).toHaveValue("none");
  await expect(page.getByLabel("回答随机性", { exact: true })).toHaveValue("0.7");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("fake-openai-key");
  expect(errors).toEqual([]);
});

test("official balances refresh after replies and switching platforms clears credentials and separates usage", async ({
  page,
}) => {
  let balanceCalls = 0;
  await page.route("https://api.deepseek.com/**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer fake-deepseek-key");
    if (route.request().url().endsWith("/user/balance")) {
      balanceCalls++;
      return route.fulfill({
        json: {
          is_available: true,
          balance_infos: [
            { currency: "CNY", total_balance: balanceCalls === 1 ? "12.34" : "11.25" },
          ],
        },
      });
    }
    return route.fulfill({
      contentType: "text/event-stream",
      body: streamReply("余额更新测试", {
        prompt_tokens: 40,
        completion_tokens: 20,
        total_tokens: 60,
      }),
    });
  });
  await page.goto("/");
  await settings(page);
  await page.getByLabel("模型平台", { exact: true }).selectOption("deepseek");
  await expect(page.getByLabel("接口地址（Base URL）", { exact: true })).toHaveValue(
    "https://api.deepseek.com",
  );
  await expect(page.getByLabel("模型名称", { exact: true })).toHaveValue("deepseek-flash");
  await page.getByLabel("API Key", { exact: true }).fill("fake-deepseek-key");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await close(page);
  const panel = page.locator("#usage-panel");
  await expect(panel.locator("[data-balance-value]")).toHaveText("¥12.34");
  await expect(panel).toContainText("0 次请求");
  await send(page, "你好");
  await expect(panel.locator("[data-balance-value]")).toHaveText("¥11.25");
  await expect(panel.locator("[data-usage-total]")).toHaveText("60 Token");
  await expect(panel).toContainText("1 次请求");
  await settings(page);
  await page.getByLabel("模型平台", { exact: true }).selectOption("openai");
  await expect(page.getByLabel("API Key", { exact: true })).toBeEmpty();
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await close(page);
  await expect(panel.locator("[data-balance-value]")).toHaveText("—");
  await expect(panel.locator("[data-usage-total]")).toHaveText("0 Token");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fake-deepseek-key",
  );
});

test("usage records from another tab update the persistent card without opening a panel", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(() => {
    const at = new Date().toISOString();
    localStorage.setItem(
      "ai-studio:usage:v1:second-tab",
      JSON.stringify({
        id: "second-tab",
        providerId: "openai-default",
        baseUrl: "https://api.openai.com/v1",
        startedAt: at,
        updatedAt: at,
        usage: { input: 10, output: 20, total: 30 },
        status: "success",
      }),
    );
  });
  await expect(page.locator("[data-usage-total]")).toHaveText("30 Token");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await other.close();
});
