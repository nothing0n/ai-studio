import {
  cleanState,
  cleanConversation,
  mergeStates,
  mergeConversation,
  clone,
  stable,
  VERSION,
} from "./data.js";

const PREFIX = "studio-data";
const encode = (value) => encodeURIComponent(value);
export class GitHubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}
export function parseRepository(value) {
  const input = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(input))
    throw new Error("请输入 owner/repository 或完整 GitHub 仓库地址");
  return input;
}
export function utf8Base64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384)
    binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}
export function base64Utf8(value) {
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(value.replace(/\s/g, "")), (char) => char.charCodeAt(0)),
  );
}

export class GitHubStore {
  constructor({ repository, token, branch = "", fetchImpl = fetch, cache = {} }) {
    this.repository = parseRepository(repository);
    if (!token?.trim()) throw new Error("请先填写 GitHub 访问令牌");
    this.token = token.trim();
    this.branch = branch.trim();
    this.fetchImpl = (...args) => fetchImpl(...args);
    this.cache = cache;
    this.root = `https://api.github.com/repos/${this.repository.split("/").map(encode).join("/")}`;
  }
  async api(path, options = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.root}${path}`, {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(30000),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw new GitHubError("无法连接 GitHub，记录已保留在本机，请检查网络后重新同步");
    }
    if (!response.ok) {
      const messages = {
        401: "GitHub 令牌无效或已过期，请重新填写",
        403: "GitHub 拒绝访问，请检查令牌权限或稍后重试（可能触发限流）",
        404: "找不到仓库、分支或文件，请检查名称和令牌的仓库授权",
        409: "仓库内容已变化，需要重新合并",
        422: "GitHub 暂时拒绝写入，请检查分支或稍后重试",
        429: "GitHub 请求过于频繁，请稍后手动同步",
      };
      throw new GitHubError(
        messages[response.status] || `GitHub 请求失败（${response.status}），本机记录仍然保留`,
        response.status,
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async verify() {
    const repo = await this.api("");
    if (!repo.private)
      throw new GitHubError("聊天数据只能连接私有仓库。请创建一个 Private 仓库后再连接");
    if (repo.archived || repo.disabled)
      throw new GitHubError("该仓库已归档或不可用，请使用可写的私有仓库");
    if (this.branch) await this.api(`/branches/${encode(this.branch)}`);
    this.defaultBranch = repo.default_branch;
    this.verified = true;
    return repo;
  }
  query() {
    return this.branch ? `?ref=${encode(this.branch)}` : "";
  }
  async readJSON(path, expectedSha) {
    if (expectedSha && this.cache[path]?.sha === expectedSha) return clone(this.cache[path]);
    let file;
    try {
      file = await this.api(`/contents/${path.split("/").map(encode).join("/")}${this.query()}`);
    } catch (error) {
      if (error.status === 404 && this.verified) return null;
      throw error;
    }
    if (file.type !== "file" || file.encoding !== "base64" || file.size > 950000)
      throw new GitHubError(`远端文件 ${path} 格式不支持或超过 950 KB，请先导出并拆分会话`);
    let data;
    try {
      data = JSON.parse(base64Utf8(file.content));
    } catch {
      throw new GitHubError(`远端文件 ${path} 无法解析，已停止同步以保护原有数据`);
    }
    const result = { sha: file.sha, data };
    this.cache[path] = clone(result);
    return result;
  }
  async writeMerged(path, local, merge) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await this.readJSON(path);
      const data = remote ? merge(local, remote.data) : local;
      if (remote && stable(data) === stable(remote.data)) return data;
      const json = JSON.stringify(data, null, 2);
      if (new TextEncoder().encode(json).length > 950000)
        throw new GitHubError("会话超过 950 KB，已留在本机。请导出备份，并开启新会话");
      try {
        const result = await this.api(`/contents/${path.split("/").map(encode).join("/")}`, {
          method: "PUT",
          body: JSON.stringify({
            message: `Sync ${path.startsWith(`${PREFIX}/conversations/`) ? "conversation" : "studio settings"}`,
            content: utf8Base64(json),
            ...(remote ? { sha: remote.sha } : {}),
            ...(this.branch ? { branch: this.branch } : {}),
          }),
        });
        this.cache[path] = { sha: result.content.sha, data: clone(data) };
        return data;
      } catch (error) {
        if (![409, 422].includes(error.status) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  async listConversations() {
    let entries;
    try {
      entries = await this.api(`/contents/${PREFIX}/conversations${this.query()}`);
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
    if (!Array.isArray(entries)) throw new GitHubError("远端会话目录格式不正确");
    if (entries.length >= 1000) {
      const tree = await this.api(
        `/git/trees/${encode(this.branch || this.defaultBranch)}?recursive=1`,
      );
      if (tree.truncated) throw new GitHubError("仓库文件过多，无法完整读取，已停止同步");
      entries = tree.tree.filter(
        (file) => file.type === "blob" && file.path.startsWith(`${PREFIX}/conversations/`),
      );
    }
    return entries
      .filter((file) => /\/([a-zA-Z0-9_-]{1,120})\.json$/.test(file.path))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
  async sync(snapshot) {
    await this.verify();
    const local = cleanState(snapshot);
    const configPath = `${PREFIX}/settings.json`;
    const baseConfig = this.cache[configPath]?.data;
    const remoteConfig = await this.readJSON(configPath);
    const remote = remoteConfig
      ? cleanState({ ...remoteConfig.data, conversations: [] })
      : { schemaVersion: VERSION, bots: [], providers: [], conversations: [] };
    const entries = await this.listConversations();
    for (const entry of entries) {
      const file = await this.readJSON(entry.path, entry.sha);
      if (file) {
        const chat = cleanConversation(file.data);
        if (entry.path !== `${PREFIX}/conversations/${chat.id}.json`)
          throw new GitHubError("远端会话 ID 与文件名不一致，已停止同步");
        remote.conversations.push(chat);
      }
    }
    let merged = mergeStates(local, remote, baseConfig);
    const config = {
      schemaVersion: VERSION,
      bots: merged.bots,
      providers: merged.providers,
    };
    const savedConfig = await this.writeMerged(configPath, config, (a, b) => {
      const result = mergeStates(
        { ...a, conversations: [] },
        cleanState({ ...b, conversations: [] }),
        baseConfig,
      );
      return {
        schemaVersion: VERSION,
        bots: result.bots,
        providers: result.providers,
      };
    });
    merged.bots = savedConfig.bots;
    merged.providers = savedConfig.providers;
    const processed = new Map();
    while (merged.conversations.some((chat) => processed.get(chat.id) !== stable(chat))) {
      const chat = merged.conversations.find((chat) => processed.get(chat.id) !== stable(chat));
      processed.set(chat.id, stable(chat));
      if (!chat.messages.length && !chat.deletedAt && !chat.profileSnapshot) continue;
      const path = `${PREFIX}/conversations/${chat.id}.json`;
      if (this.cache[path] && stable(this.cache[path].data) === stable(chat)) continue;
      const saved = await this.writeMerged(path, chat, (a, b) => {
        const pair = mergeStates(
          { schemaVersion: VERSION, bots: [], providers: [], conversations: [a] },
          {
            schemaVersion: VERSION,
            bots: [],
            providers: [],
            conversations: [cleanConversation(b)],
          },
        );
        for (const recovered of pair.conversations.filter((item) => item.id !== a.id)) {
          const existing = merged.conversations.find((item) => item.id === recovered.id);
          if (existing) Object.assign(existing, mergeConversation(existing, recovered));
          else merged.conversations.push(recovered);
        }
        return pair.conversations.find((item) => item.id === a.id);
      });
      merged = mergeStates(merged, {
        schemaVersion: VERSION,
        bots: [],
        providers: [],
        conversations: [saved],
      });
    }
    return { state: cleanState(merged), cache: clone(this.cache) };
  }
}
