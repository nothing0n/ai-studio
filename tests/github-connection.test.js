import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchRepositories,
  fetchBranches,
  testGitHubConnection,
} from "../src/github-connection.js";

function api(handler) {
  const calls = [];
  return {
    calls,
    token: "fake-test-token",
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, "Bearer fake-test-token");
      assert.ok(!options.method || options.method === "GET");
      assert.equal(options.redirect, "error");
      assert.ok(url.startsWith("https://api.github.com/"));
      return handler(new URL(url));
    },
  };
}

test("repository discovery paginates and exposes only active private repositories", async () => {
  const options = api((url) => {
    assert.equal(url.pathname, "/user/repos");
    assert.equal(url.searchParams.get("visibility"), "private");
    assert.ok(!url.searchParams.has("type"));
    return Response.json(
      url.searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, (_, i) => ({ full_name: `test/repo-${i}`, private: true }))
        : [
            { full_name: "test/private", private: true },
            { full_name: "test/public", private: false },
            { full_name: "test/archived", private: true, archived: true },
          ],
    );
  });
  const result = await fetchRepositories(options);
  assert.equal(result.repositories.length, 101);
  assert.equal(options.calls.length, 2);
  assert.equal(result.truncated, false);
});

test("branch discovery paginates and retains slash branch names", async () => {
  const options = api((url) =>
    Response.json(
      url.searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, (_, i) => ({ name: `branch-${i}` }))
        : [{ name: "feature/data" }],
    ),
  );
  const result = await fetchBranches({ repository: "test/data", ...options });
  assert.equal(result.branches.at(-1), "feature/data");
  assert.equal(options.calls.length, 2);
});

test("connectivity checks selected branch contents using only read requests", async () => {
  const options = api((url) =>
    Response.json(
      url.pathname.endsWith("/data")
        ? { private: true, default_branch: "main" }
        : url.pathname.endsWith("/contents")
          ? []
          : { name: "feature/data" },
    ),
  );
  const result = await testGitHubConnection({
    repository: "test/data",
    branch: "feature/data",
    ...options,
  });
  assert.equal(result.branch, "feature/data");
  assert.ok(options.calls[1].endsWith("/branches/feature%2Fdata"));
  assert.ok(options.calls[2].endsWith("/contents?ref=feature%2Fdata"));
});

test("public and archived repositories fail before reading contents", async () => {
  for (const repo of [{ private: false }, { private: true, archived: true }]) {
    const options = api(() => Response.json(repo));
    await assert.rejects(
      testGitHubConnection({ repository: "test/data", ...options }),
      /私有仓库|已归档/,
    );
    assert.equal(options.calls.length, 1);
  }
});

test("explicit empty repositories work with automatic branch but generic 404 and 409 do not pass", async () => {
  for (const [status, message, empty] of [
    [404, "This repository is empty.", true],
    [409, "Git Repository is empty.", true],
    [404, "Not Found", false],
    [409, "Git Repository is unavailable.", false],
  ]) {
    const options = api((url) =>
      url.pathname.endsWith("/data")
        ? Response.json({ private: true, default_branch: "main" })
        : Response.json({ message }, { status }),
    );
    const promise = testGitHubConnection({ repository: "test/data", ...options });
    if (empty) assert.equal((await promise).empty, true);
    else await assert.rejects(promise);
    assert.ok(options.calls.every((url) => !url.includes("/branches/")));
  }
});

test("permission errors and invalid successful content payloads cannot pass or echo secret data", async () => {
  for (const response of [
    () => Response.json({ message: "fake-test-token" }, { status: 403 }),
    () => Response.json({ unexpected: "fake-test-token" }),
  ]) {
    const options = api((url) =>
      url.pathname.endsWith("/data")
        ? Response.json({ private: true, default_branch: "main" })
        : response(),
    );
    await assert.rejects(testGitHubConnection({ repository: "test/data", ...options }), (error) => {
      assert.ok(!error.message.includes("fake-test-token"));
      return true;
    });
  }
});
