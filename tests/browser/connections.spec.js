import { test, expect } from "@playwright/test";

async function settings(page, tab = "模型连接") {
  const menu = page.getByRole("button", { name: "打开角色和历史对话", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "设置与连接", exact: true }).click();
  if (tab !== "模型连接") await page.getByRole("tab", { name: tab, exact: true }).click();
}

test("model test uses the draft configuration, records usage and does not create or save a chat", async ({
  page,
}) => {
  const requests = [];
  await page.route("https://api.openai.com/**", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer fake-draft-key");
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      },
    });
  });
  await page.goto("/");
  const before = await page.evaluate(() => localStorage.getItem("ai-studio:data:v1"));
  await settings(page);
  await page.getByLabel("API Key", { exact: true }).fill("fake-draft-key");
  await page.getByLabel("模型名称", { exact: true }).selectOption("gpt-4.1-mini");
  await page.getByRole("button", { name: "测试连通性", exact: true }).click();
  await expect(page.locator("#model-test-status")).toContainText("测试通过");
  expect(requests[0].model).toBe("gpt-4.1-mini");
  expect(requests[0].messages).toEqual([{ role: "user", content: "Reply only OK." }]);
  expect(requests[0].max_completion_tokens).toBe(1024);
  expect(await page.evaluate(() => localStorage.getItem("ai-studio:data:v1"))).toBe(before);
  await expect(page.locator("[data-usage-total]")).toHaveText("12 Token");
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("fake-draft-key");
  await page.getByLabel("API Key", { exact: true }).fill("changed-key");
  await expect(page.locator("#model-test-status")).toContainText("配置已更改");
});

test("model authentication failures are clear and changing a key cancels stale test results", async ({
  page,
}) => {
  let release, started;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  await page.route("https://api.openai.com/**", async (route) => {
    if (route.request().headers().authorization === "Bearer bad-key")
      return route.fulfill({ status: 401, json: { error: { message: "bad-key" } } });
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ json: { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] } })
      .catch(() => {});
  });
  await page.goto("/");
  await settings(page);
  await page.getByLabel("API Key", { exact: true }).fill("bad-key");
  await page.getByRole("button", { name: "测试连通性", exact: true }).click();
  await expect(page.locator("#model-test-status")).toContainText("密钥无效或已过期");
  await page.getByLabel("API Key", { exact: true }).fill("pending-key");
  await page.getByRole("button", { name: "测试连通性", exact: true }).click();
  await requested;
  await page.getByLabel("API Key", { exact: true }).fill("replacement-key");
  release();
  await expect(page.locator("#model-test-status")).toContainText("配置已更改");
  await expect(page.getByRole("button", { name: "测试连通性", exact: true })).toBeEnabled();
  await expect(page.locator("[data-usage-total]")).toHaveText("用量未返回");
});

test("GitHub dropdowns discover private repositories and branches; testing is read only and does not save credentials", async ({
  page,
}, info) => {
  const calls = [];
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    calls.push(url.pathname + url.search);
    expect(req.method()).toBe("GET");
    expect(req.headers().authorization).toBe("Bearer fake-draft-github");
    if (url.pathname === "/user/repos")
      return route.fulfill({
        json: [
          { full_name: "test/private", private: true, default_branch: "main" },
          { full_name: "test/public", private: false },
        ],
      });
    if (url.pathname.endsWith("/branches"))
      return route.fulfill({ json: [{ name: "main" }, { name: "feature/data" }] });
    if (url.pathname.includes("/branches/"))
      return route.fulfill({ json: { name: "feature/data" } });
    if (url.pathname.endsWith("/contents")) {
      expect(url.searchParams.get("ref")).toBe("feature/data");
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: { private: true, default_branch: "main" } });
  });
  await page.goto("/");
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  await settings(page, "GitHub 同步");
  await page.getByLabel("GitHub 访问令牌", { exact: true }).fill("fake-draft-github");
  await page.getByRole("button", { name: "读取仓库", exact: true }).click();
  await expect(page.locator("#repository-status")).toContainText("已读取 1 个私有仓库");
  await expect(
    page.getByLabel("数据仓库", { exact: true }).locator('option[value="test/public"]'),
  ).toHaveCount(0);
  await page.getByLabel("数据仓库", { exact: true }).selectOption("test/private");
  await page.getByRole("button", { name: "读取分支", exact: true }).click();
  await expect(page.locator("#branch-status")).toContainText("已读取 2 个分支");
  await page.getByLabel("分支", { exact: true }).selectOption("feature/data");
  await page.getByRole("button", { name: "测试连通性", exact: true }).click();
  await expect(page.locator("#github-test-status")).toContainText("私有仓库内容可读取");
  await expect(page.locator("#github-test-status")).toContainText("写入权限将在同步时验证");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(saved);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
    "fake-draft-github",
  );
  expect(calls.some((url) => url.includes("feature%2Fdata"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: `.local/${info.project.name}-github-dropdowns.png`,
    fullPage: true,
  });
  await page.getByLabel("GitHub 访问令牌", { exact: true }).fill("replacement-token");
  await expect(page.locator("#github-test-status")).toContainText("配置已更改");
  await page.getByLabel("数据仓库", { exact: true }).selectOption("__custom__");
  await expect(page.getByLabel("手动仓库地址", { exact: true })).toBeVisible();
  await page.getByLabel("分支", { exact: true }).selectOption("__custom__");
  await expect(page.getByLabel("手动分支名称", { exact: true })).toBeVisible();
});
