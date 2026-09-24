import "./style.css";
import {
  createIcons,
  Sparkles,
  Map as MapIcon,
  Layers,
  ChartNoAxesCombined,
  Plus,
  Settings2,
  Menu,
  X,
  ArrowUp,
  ArrowUpRight,
  RefreshCw,
  Cloud,
  Check,
  ChevronDown,
  MessageSquare,
  Pencil,
  Trash2,
  Copy,
  Download,
  Upload,
  KeyRound,
  GitBranch as Github,
  Bot,
  PenTool,
  Code,
  Lightbulb,
  Square,
  RotateCcw,
  ExternalLink,
} from "lucide";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  initialState,
  cleanState,
  createConversation,
  uid,
  now,
  clone,
  stable,
  mergeStates,
  routeByKeywords,
  promptMessages,
  endpointURL,
} from "./data.js";
import {
  loadState,
  saveState,
  loadDevice,
  saveDevice,
  getSecrets,
  setSecrets,
  clearSecrets,
} from "./storage.js";
import { completeChat, selectBot } from "./ai.js";
import { GitHubStore, parseRepository } from "./github.js";

const ICONS = {
  Sparkles,
  Map: MapIcon,
  Layers,
  ChartNoAxesCombined,
  Plus,
  Settings2,
  Menu,
  X,
  ArrowUp,
  ArrowUpRight,
  RefreshCw,
  Cloud,
  Check,
  ChevronDown,
  MessageSquare,
  Pencil,
  Trash2,
  Copy,
  Download,
  Upload,
  KeyRound,
  Github,
  Bot,
  PenTool,
  Code,
  Lightbulb,
  Square,
  RotateCcw,
  ExternalLink,
};
const icon = (name, className = "") => `<i data-lucide="${name}" class="${className}"></i>`;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
let bootError = "";
let state;
try {
  state = loadState();
} catch {
  state = initialState();
  bootError = "本机记录无法读取，原始数据仍保留。请先导出原始备份。";
}
let device = loadDevice();
const ui = {
  activeId: device.activeId || null,
  selectedBot: "butler",
  mode: "auto",
  sidebar: false,
  draft: "",
  busy: false,
  routing: false,
  controller: null,
  syncBusy: false,
  syncStatus: device.lastSync ? "synced" : "local",
  syncError: "",
  forceRoute: false,
  editingProvider: null,
};
let syncTimer,
  toastTimer,
  syncAgain = false,
  revision = 0;
let deferredState = null;
let lastSavedState = clone(state);
const app = document.querySelector("#app");
const roleOrder = ["butler"];
const bots = () =>
  state.bots
    .filter((bot) => !bot.deletedAt)
    .sort((a, b) => {
      const rank = (item) => (roleOrder.includes(item.id) ? roleOrder.indexOf(item.id) : 10);
      return rank(a) - rank(b);
    });
const providers = () => state.providers.filter((provider) => !provider.deletedAt);
const chats = () =>
  state.conversations
    .filter((chat) => !chat.deletedAt && chat.messages.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
const currentChat = () =>
  state.conversations.find((chat) => chat.id === ui.activeId && !chat.deletedAt);
const getBot = (id) =>
  bots().find((bot) => bot.id === id) || bots().find((bot) => bot.id === "butler");
const activeBot = () => getBot(currentChat()?.botId || ui.selectedBot);
const mode = () => currentChat()?.mode || ui.mode;
function modelForBot(bot) {
  return (
    providers().find((p) => p.id === bot.providerId) ||
    providers().find((p) => p.id === getBot("butler").providerId) ||
    providers()[0]
  );
}
function keyFor(provider) {
  const entry = getSecrets().models?.[provider.id];
  if (entry && entry.baseUrl !== provider.baseUrl)
    throw new Error("模型接口地址已变化，请为新地址重新填写密钥");
  return entry?.key || "";
}
function icons() {
  createIcons({ icons: ICONS });
}
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 5500);
}
function rememberDevice() {
  try {
    saveDevice(device);
  } catch {
    toast("无法保存设备设置，请检查浏览器存储空间");
  }
}
function persist({ sync = true, changed = true } = {}) {
  if (bootError) {
    toast(bootError);
    return false;
  }
  try {
    const raw = localStorage.getItem("ai-studio:data:v1");
    const disk = raw ? cleanState(JSON.parse(raw)) : null;
    let persisted = disk ? mergeStates(state, disk, lastSavedState) : state;
    if (deferredState) persisted = mergeStates(persisted, deferredState);
    if (!disk || stable(persisted) !== stable(disk)) saveState(persisted);
    lastSavedState = clone(persisted);
    if (ui.busy) deferredState = clone(persisted);
    else applyState(persisted);
    if (changed) revision++;
    ui.syncStatus = device.repository ? "pending" : "local";
    if (sync) scheduleSync();
    return true;
  } catch {
    toast("本机存储空间不足，当前内容仍在页面中。请立即导出备份");
    ui.syncError = "本机保存失败，请导出备份";
    return false;
  }
}
function applyState(next) {
  const existing = new Map(state.conversations.map((chat) => [chat.id, chat]));
  next.conversations = next.conversations.map((chat) => {
    const current = existing.get(chat.id);
    if (!current) return chat;
    const messages = new Map(current.messages.map((message) => [message.id, message]));
    chat.messages = chat.messages.map((message) => {
      const original = messages.get(message.id);
      return original ? Object.assign(original, message) : message;
    });
    return Object.assign(current, chat);
  });
  state = next;
}
function markdown(content) {
  const html = DOMPurify.sanitize(marked.parse(content, { breaks: true, gfm: true }), {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: ["href", "title", "start"],
    ALLOW_DATA_ATTR: false,
  });
  const fragment = document.createElement("div");
  fragment.innerHTML = html;
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
    else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  return fragment.innerHTML;
}
function avatar(bot) {
  return `<span class="avatar ${esc(bot.color)}">${icon(bot.icon)}</span>`;
}
function render() {
  const bot = activeBot(),
    conversation = currentChat(),
    allChats = chats(),
    provider = modelForBot(bot);
  const syncLabels = {
    local: "本地保存",
    pending: "等待同步",
    synced: "已同步",
    error: "同步失败",
    syncing: "正在同步",
  };
  app.innerHTML = `<button class="sidebar-overlay ${ui.sidebar ? "visible" : ""}" data-action="close-sidebar" aria-label="关闭侧栏"></button>
  <aside class="sidebar ${ui.sidebar ? "open" : ""}" aria-label="角色和历史对话">
    <a class="brand" href="#" data-action="new"><span class="brand-mark">✦</span><span>AI Bot</span></a>
    <button class="new-chat" data-action="new">${icon("plus")}<span>新对话</span></button>
    <div class="nav-label">我的团队<button class="icon-button" data-action="add-bot" aria-label="添加角色">${icon("plus")}</button></div>
    <nav class="team-nav">${bots()
      .map(
        (item) =>
          `<div class="bot-nav-wrap"><button class="bot-nav ${bot.id === item.id ? "active" : ""}" data-bot="${item.id}" ${bot.id === item.id ? 'aria-current="true"' : ""}>${avatar(item)}<span>${esc(item.name)}</span></button><button class="edit-bot icon-button" data-edit-bot="${item.id}" aria-label="编辑${esc(item.name)}">${icon("pencil")}</button></div>`,
      )
      .join("")}</nav>
    <div class="nav-label history-label">最近对话 <span>${allChats.length || ""}</span></div>
    <div class="history-list">${allChats.length ? allChats.map((chat) => `<div class="history-item ${ui.activeId === chat.id ? "active" : ""}"><button data-chat="${chat.id}" title="${esc(chat.title)}">${icon("message-square")}<span>${esc(chat.title)}</span></button><button class="delete-chat icon-button" data-delete-chat="${chat.id}" aria-label="删除会话：${esc(chat.title)}">${icon("trash-2")}</button></div>`).join("") : ""}</div>
    <div class="sidebar-bottom"><button class="bottom-button" data-action="settings">${icon("settings-2")}<span>设置与连接</span></button></div>
  </aside>
  <main class="main ${conversation?.messages.length ? "" : "is-empty"}"><header class="topbar"><button class="mobile-menu icon-button" data-action="open-sidebar" aria-label="打开角色和历史对话">${icon("menu")}</button><div class="breadcrumb"><strong>${esc(bot.name)}</strong>${conversation ? `<button class="icon-button title-edit" data-action="rename" aria-label="重命名会话">${icon("pencil")}</button>` : ""}</div><div class="topbar-actions"><span class="save-badge ${ui.syncStatus === "error" ? "error" : ""}" title="${esc(ui.syncError)}">${ui.syncStatus === "synced" ? icon("check") : ""}${syncLabels[ui.syncBusy ? "syncing" : ui.syncStatus]}</span><button class="text-button sync-button" data-action="${device.repository ? "sync" : "github-settings"}" ${ui.syncBusy ? "disabled" : ""}>${icon(device.repository ? "refresh-cw" : "cloud", ui.syncBusy ? "spin" : "")}<span>${device.repository ? "同步" : "连接 GitHub"}</span></button></div></header>
  ${bootError ? `<div class="notice error-notice">${esc(bootError)} <button data-action="raw-backup">导出原始备份</button></div>` : ""}
  <section class="chat-area" aria-label="聊天内容">${conversation?.messages.length ? `<div class="messages">${conversation.messages.map(renderMessage).join("")}</div>` : ""}</section>
  <div class="composer-wrap">${ui.routing ? `<div class="activity-line">${icon("sparkles")}管家正在邀请合适的伙伴…</div>` : ""}<form class="composer" id="composer"><textarea id="message-input" aria-label="输入消息" placeholder="输入消息…" rows="2" maxlength="30000" ${ui.busy ? "disabled" : ""}>${esc(ui.draft)}</textarea><div class="composer-tools"><button class="route-chip" type="button" data-action="route-toggle" title="${mode() === "auto" ? "点击固定当前角色" : "点击交给管家自动分配"}">${icon(mode() === "auto" ? "sparkles" : bot.icon)}${mode() === "auto" ? "管家自动分配" : esc(bot.name)}${icon("chevron-down")}</button><div><button class="model-note" type="button" data-action="settings" title="配置模型">${provider ? esc(provider.name) : "选择模型"}${icon("chevron-down")}</button><button class="send-button" type="${ui.busy ? "button" : "submit"}" ${ui.busy ? 'data-action="stop"' : ""} aria-label="${ui.busy ? "停止生成" : "发送消息"}">${icon(ui.busy ? "square" : "arrow-up")}</button></div></div></form></div></main>`;
  icons();
  const input = document.querySelector("#message-input");
  input.addEventListener("input", () => {
    ui.draft = input.value;
    input.style.height = "auto";
    input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.querySelector("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage();
  });
}
function renderMessage(message) {
  const bot = getBot(message.botId),
    isUser = message.role === "user";
  const statuses = {
    streaming: "正在思考",
    stopped: "已停止",
    error: message.error || "生成失败",
    interrupted: message.error || "连接中断",
    length: "达到模型输出长度限制，可发送“继续”",
    content_filter: "回答被模型服务截断",
  };
  return `<article class="message ${isUser ? "user-message" : "assistant-message"}" data-message="${message.id}">${isUser ? '<span class="user-avatar">我</span>' : avatar(bot)}<div class="message-main"><div class="message-heading"><strong>${isUser ? "你" : esc(message.botName || bot.name)}</strong><time datetime="${esc(message.createdAt)}">${new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div><div class="message-content markdown" id="content-${message.id}">${message.content ? markdown(message.content) : message.status === "streaming" ? '<span class="thinking"><span></span><span></span><span></span></span>' : ""}</div><div class="message-footer">${statuses[message.status] ? `<span class="message-status ${["error", "interrupted"].includes(message.status) ? "error" : ""}">${esc(statuses[message.status])}</span>` : ""}${message.content ? `<button class="icon-button copy-message" data-copy="${message.id}" aria-label="复制消息">${icon("copy")}</button>` : ""}${!isUser && !ui.busy && ["error", "stopped", "interrupted"].includes(message.status) ? `<button class="retry-button" data-retry="${message.id}">${icon("rotate-ccw")}重试回答</button>` : ""}</div></div></article>`;
}
function scrollBottom(force = true) {
  const area = document.querySelector(".chat-area");
  if (area && (force || area.scrollHeight - area.scrollTop - area.clientHeight < 180))
    area.scrollTo({ top: area.scrollHeight, behavior: "instant" });
}
function renderStream(message) {
  const target = document.getElementById(`content-${message.id}`);
  if (target) {
    const area = document.querySelector(".chat-area");
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 180;
    target.innerHTML = markdown(message.content);
    if (nearBottom) scrollBottom();
  }
}
function chooseBot(id) {
  if (ui.busy) return toast("请先停止当前回答，再切换角色");
  const bot = getBot(id);
  ui.selectedBot = bot.id;
  ui.mode = bot.id === "butler" ? "auto" : "manual";
  ui.forceRoute = bot.id === "butler";
  ui.sidebar = false;
  const chat = currentChat();
  if (chat) {
    chat.botId = bot.id;
    chat.mode = ui.mode;
    chat.updatedAt = now();
    persist();
  }
  render();
  if (chat) scrollBottom();
}
function newChat() {
  if (ui.busy) return toast("请先停止当前回答");
  ui.activeId = null;
  ui.selectedBot = "butler";
  ui.mode = "auto";
  ui.draft = "";
  ui.sidebar = false;
  device.activeId = null;
  rememberDevice();
  render();
  document.querySelector("#message-input").focus();
}

async function sendMessage(retryMessageId) {
  if (ui.busy || bootError) return;
  if (ui.syncBusy) return toast("正在同步记录，请稍后发送。草稿已保留");
  let conversation = currentChat();
  const previous = retryMessageId && conversation?.messages.find((m) => m.id === retryMessageId);
  const retryUser =
    previous && conversation.messages.find((m) => m.id === previous.replyTo && m.role === "user");
  if (
    retryUser &&
    conversation.messages.filter((message) => message.role === "user").at(-1)?.id !== retryUser.id
  )
    return toast("只能重试最近一个问题的回答，请重新提出之前的问题");
  const content = retryUser ? retryUser.content : ui.draft.trim();
  if (!content) return;
  if (!providers().length) {
    showSettings("models");
    toast("先添加一个模型连接，输入的消息已经保留");
    return;
  }
  if (!conversation) {
    conversation = createConversation(ui.selectedBot);
    conversation.mode = ui.mode;
    state.conversations.push(conversation);
    ui.activeId = conversation.id;
    device.activeId = conversation.id;
    rememberDevice();
  }
  if (!retryUser) {
    const timestamp = now();
    conversation.messages.push({
      id: uid(),
      role: "user",
      content,
      botId: "",
      botName: "",
      replyTo: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "complete",
      error: "",
    });
    if (conversation.messages.filter((m) => m.role === "user").length === 1)
      conversation.title = content.replace(/\s+/g, " ").slice(0, 32);
    ui.draft = "";
  }
  conversation.updatedAt = now();
  if (!persist({ sync: false })) {
    render();
    return;
  }
  ui.busy = true;
  ui.controller = new AbortController();
  let timedOut = false,
    responseMessage,
    timer;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ui.controller?.abort();
    }, 120000);
  };
  resetTimeout();
  render();
  scrollBottom();
  try {
    let bot = getBot(previous?.botId || conversation.botId);
    if (!retryUser && conversation.mode === "auto") {
      let targetId = routeByKeywords(content, bots(), bot.id);
      if (
        (conversation.messages.filter((m) => m.role === "user").length === 1 || ui.forceRoute) &&
        (targetId === "butler" || ui.forceRoute) &&
        bots().length > 1
      ) {
        ui.routing = true;
        render();
        scrollBottom();
        const provider = modelForBot(getBot("butler"));
        try {
          targetId = await selectBot({
            text: content,
            bots: bots(),
            provider,
            apiKey: keyFor(provider),
            signal: ui.controller.signal,
          });
        } catch (error) {
          if (ui.controller.signal.aborted) throw error;
          toast("管家暂时无法判断，先按当前角色继续");
        }
      }
      bot = getBot(targetId);
      conversation.botId = bot.id;
      ui.forceRoute = false;
    }
    ui.routing = false;
    const provider = modelForBot(bot);
    const timestamp = now();
    const user = retryUser || conversation.messages.filter((m) => m.role === "user").at(-1);
    responseMessage = {
      id: uid(),
      role: "assistant",
      content: "",
      botId: bot.id,
      botName: bot.name,
      replyTo: user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "streaming",
      error: "",
    };
    const contextChat = retryUser
      ? {
          ...conversation,
          messages: conversation.messages.slice(0, conversation.messages.indexOf(retryUser) + 1),
        }
      : conversation;
    const messages = promptMessages(contextChat, bot, bots());
    conversation.messages.push(responseMessage);
    persist({ sync: false });
    render();
    scrollBottom();
    let lastPaint = 0,
      lastSave = 0;
    const result = await completeChat({
      provider,
      apiKey: keyFor(provider),
      messages,
      signal: ui.controller.signal,
      onDelta(delta) {
        responseMessage.content += delta;
        responseMessage.updatedAt = now();
        resetTimeout();
        if (performance.now() - lastPaint > 60) {
          renderStream(responseMessage);
          lastPaint = performance.now();
        }
        if (performance.now() - lastSave > 1200) {
          persist({ sync: false });
          lastSave = performance.now();
        }
      },
    });
    responseMessage.status = ["length", "content_filter"].includes(result.finishReason)
      ? result.finishReason
      : "complete";
  } catch (error) {
    if (!responseMessage) {
      const timestamp = now();
      responseMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        botId: conversation.botId,
        botName: getBot(conversation.botId).name,
        replyTo: conversation.messages.filter((m) => m.role === "user").at(-1)?.id || "",
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "error",
        error: "",
      };
      conversation.messages.push(responseMessage);
    }
    responseMessage.status = ui.controller.signal.aborted
      ? timedOut
        ? "interrupted"
        : "stopped"
      : "error";
    responseMessage.error = timedOut
      ? "模型超过两分钟没有响应，已停止请求；可重试"
      : ui.controller.signal.aborted
        ? ""
        : error.message;
  } finally {
    clearTimeout(timer);
    if (responseMessage) responseMessage.updatedAt = now();
    conversation.updatedAt = now();
    ui.busy = false;
    ui.routing = false;
    ui.controller = null;
    if (deferredState) {
      applyState(mergeStates(state, deferredState));
      deferredState = null;
    }
    persist();
    render();
    scrollBottom();
    document.querySelector("#message-input")?.focus();
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  if (!device.repository || !getSecrets().github?.token) return;
  syncTimer = setTimeout(() => runSync(false), 5000);
}
async function runSync(manual = true) {
  if (bootError) return toast(bootError);
  if (!device.repository || !getSecrets().github?.token) {
    if (manual) showSettings("github");
    return;
  }
  if (ui.busy) {
    syncAgain = true;
    if (manual) toast("回答完成后会自动同步");
    return;
  }
  if (ui.syncBusy) {
    syncAgain = true;
    return;
  }
  if (!navigator.onLine) {
    ui.syncStatus = "pending";
    if (manual) toast("当前离线，记录已保存在本机");
    return;
  }
  ui.syncBusy = true;
  ui.syncStatus = "syncing";
  ui.syncError = "";
  render();
  const startRevision = revision;
  const snapshot = clone(state);
  const cacheKey = `ai-studio:sync:${device.repository}:${device.branch || ""}`;
  try {
    const sync = async () => {
      let cache;
      try {
        cache = JSON.parse(localStorage.getItem(cacheKey)) || {};
      } catch {
        cache = {};
      }
      const store = new GitHubStore({
        repository: device.repository,
        branch: device.branch,
        token: getSecrets().github.token,
        cache,
      });
      return store.sync(snapshot);
    };
    const result = navigator.locks
      ? await navigator.locks.request(`ai-studio-sync:${device.repository}`, sync)
      : await sync();
    applyState(mergeStates(state, result.state, snapshot));
    if (!persist({ sync: false, changed: false }))
      throw new Error("同步结果未能保存在本机，请导出备份后重试");
    try {
      localStorage.setItem(cacheKey, JSON.stringify(result.cache));
    } catch {}
    device.lastSync = now();
    rememberDevice();
    ui.syncStatus = revision === startRevision ? "synced" : "pending";
    if (revision !== startRevision) syncAgain = true;
    if (manual) toast("同步完成，电脑和手机可以继续同一段对话");
  } catch (error) {
    ui.syncStatus = "error";
    ui.syncError = error.message;
    if (manual) toast(error.message);
  } finally {
    ui.syncBusy = false;
    render();
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

function closeDialog() {
  const dialog = document.querySelector("#app-dialog");
  if (dialog) {
    dialog.close();
    dialog.remove();
  }
}
function openDialog(content, extra = "") {
  closeDialog();
  const dialog = document.createElement("dialog");
  dialog.id = "app-dialog";
  dialog.className = `dialog ${extra}`;
  dialog.innerHTML = content;
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const b = dialog.getBoundingClientRect();
      if (
        event.clientX < b.left ||
        event.clientX > b.right ||
        event.clientY < b.top ||
        event.clientY > b.bottom
      )
        closeDialog();
    }
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  icons();
  return dialog;
}
const heading = (title, subtitle = "") =>
  `<div class="dialog-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon("x")}</button></div>`;
const field = (label, input, hint = "") =>
  `<label class="field"><span>${label}</span>${input.replace(/^<(input|textarea|select)\b/, `<$1 aria-label="${esc(label)}"`)}${hint ? `<small>${hint}</small>` : ""}</label>`;
function showSettings(tab = "models") {
  if (ui.sidebar) {
    ui.sidebar = false;
    render();
  }
  const descriptions = {
    models: "连接你的模型，为不同角色分配不同的能力。",
    github: "用你的私有仓库，让电脑和手机接着聊。",
    data: "随时带走角色配置和聊天记录。密钥不包含在备份中。",
  };
  const content =
    tab === "models" ? modelsSettings() : tab === "github" ? githubSettings() : dataSettings();
  const dialog = openDialog(
    `${heading("设置与连接", descriptions[tab])}<div class="settings-tabs" role="tablist">${[
      ["models", "模型连接"],
      ["github", "GitHub 同步"],
      ["data", "数据与备份"],
    ]
      .map(
        ([key, name]) =>
          `<button role="tab" aria-selected="${tab === key}" class="${tab === key ? "active" : ""}" data-tab="${key}">${name}</button>`,
      )
      .join("")}</div><div class="settings-content">${content}</div>`,
    "settings-dialog",
  );
  if (tab === "models")
    dialog.querySelector("#provider-form")?.addEventListener("submit", saveProvider);
  if (tab === "github")
    dialog.querySelector("#github-form").addEventListener("submit", connectGitHub);
  if (tab === "data") dialog.querySelector("#import-file").addEventListener("change", importBackup);
}
function modelsSettings() {
  const editing = providers().find((p) => p.id === ui.editingProvider),
    savedKey = editing ? getSecrets().models?.[editing.id] : null;
  return `${
    providers().length
      ? `<div class="connection-list">${providers()
          .map(
            (p) =>
              `<div class="connection-card"><div class="connection-icon">${icon("bot")}</div><div><strong>${esc(p.name)}</strong><small>${esc(p.model)}</small></div><button class="text-button" data-edit-provider="${p.id}">编辑</button><button class="icon-button" data-delete-provider="${p.id}" aria-label="删除${esc(p.name)}">${icon("trash-2")}</button></div>`,
          )
          .join("")}</div>`
      : '<div class="setup-note">支持 OpenAI 兼容的 Chat Completions 接口。模型服务需要允许浏览器直接调用。</div>'
  }<form id="provider-form"><h3>${editing ? "编辑模型连接" : "添加模型连接"}</h3><div class="field-row">${field("连接名称", '<input name="name" required maxlength="80" placeholder="例如：我的主力模型" value="' + esc(editing?.name) + '">')}${field("模型名称", '<input name="model" required maxlength="160" placeholder="供应商提供的模型 ID" value="' + esc(editing?.model) + '">')}</div>${field("接口地址（Base URL）", '<input name="baseUrl" required type="url" placeholder="https://api.example.com/v1" value="' + esc(editing?.baseUrl) + '">', "填 API 地址，不是聊天网页地址。也支持本机 localhost。")}${field("API Key", '<input name="apiKey" type="password" autocomplete="off" placeholder="仅保存在本次浏览器会话，不同步到仓库" value="' + esc(savedKey?.baseUrl === editing?.baseUrl ? savedKey?.key : "") + '">', "密钥可留空，用于不需要认证的本机服务。每台设备分别填写。")}<div class="form-actions">${editing ? '<button class="secondary-button" type="button" data-action="new-provider">取消编辑</button>' : ""}<button class="primary-button" type="submit">${icon("check")}保存连接</button></div></form>`;
}
function saveProvider(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const existing = providers().find((p) => p.id === ui.editingProvider);
    const provider = {
      id: existing?.id || uid(),
      name: String(form.get("name")).trim(),
      model: String(form.get("model")).trim(),
      baseUrl: endpointURL(String(form.get("baseUrl")).trim()),
      updatedAt: now(),
      deletedAt: null,
    };
    if (!provider.name || !provider.model) throw new Error("请填写连接名称和模型名称");
    if (existing) Object.assign(existing, provider);
    else state.providers.push(provider);
    const secrets = getSecrets();
    secrets.models ||= {};
    secrets.models[provider.id] = {
      key: String(form.get("apiKey")).trim(),
      baseUrl: provider.baseUrl,
    };
    setSecrets(secrets);
    if (
      !getBot("butler").providerId ||
      !providers().some((p) => p.id === getBot("butler").providerId)
    ) {
      getBot("butler").providerId = provider.id;
      getBot("butler").updatedAt = now();
    }
    persist();
    ui.editingProvider = null;
    render();
    showSettings("models");
    toast("模型连接已保存，可以开始聊天");
  } catch (error) {
    toast(error.message);
  }
}
function githubSettings() {
  return `<div class="setup-note github-note">${icon("github")}<div>网页与聊天数据分开保存。这里连接的必须是 <strong>Private 私有仓库</strong>，可以是空仓库。</div></div><form id="github-form">${field("数据仓库", '<input name="repository" required placeholder="你的用户名/私有数据仓库" value="' + esc(device.repository) + '">')}${field("GitHub 访问令牌", '<input name="token" type="password" required autocomplete="off" placeholder="github_pat_…" value="' + esc(getSecrets().github?.token) + '">', "仅授权这个仓库的 Contents → Read and write。令牌只保存在本次浏览器会话。")}${field("分支（可选）", '<input name="branch" placeholder="留空使用仓库默认分支" value="' + esc(device.branch) + '">')}<div class="help-links"><a href="https://github.com/new" target="_blank" rel="noopener noreferrer">创建私有仓库 ${icon("external-link")}</a><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建访问令牌 ${icon("external-link")}</a></div><div class="sync-explanation"><strong>同步会怎样工作</strong><p>每轮回答完成后自动保存；打开网页或回到页面时拉取更新。两个设备的新增消息会合并。同步失败时保留本机记录。</p><p>仓库保留历史版本，删除会话不会抹去 Git 历史。模型密钥与 GitHub 令牌不会写入仓库。</p></div>${ui.syncError ? `<div class="inline-error">${esc(ui.syncError)}</div>` : ""}<div class="form-actions">${device.repository ? '<button class="secondary-button" type="button" data-action="disconnect">断开同步</button>' : ""}<button class="primary-button" type="submit" ${ui.syncBusy ? "disabled" : ""}>${icon("refresh-cw")}连接并同步</button></div></form>`;
}
async function connectGitHub(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const repository = parseRepository(String(form.get("repository"))),
      token = String(form.get("token")).trim();
    if (!token) throw new Error("请填写 GitHub 访问令牌");
    device.repository = repository;
    device.branch = String(form.get("branch")).trim();
    rememberDevice();
    const secrets = getSecrets();
    secrets.github = { token };
    setSecrets(secrets);
    closeDialog();
    await runSync(true);
    if (ui.syncStatus === "error") showSettings("github");
  } catch (error) {
    toast(error.message);
  }
}
function dataSettings() {
  return `<div class="data-stats"><div><strong>${chats().length}</strong><span>段对话</span></div><div><strong>${bots().length}</strong><span>位角色</span></div><div><strong>${providers().length}</strong><span>个模型连接</span></div></div><div class="data-action"><div><strong>导出备份</strong><p>下载角色、模型地址与聊天记录，不包含任何密钥。</p></div><button class="secondary-button" data-action="export">${icon("download")}导出</button></div><div class="data-action"><div><strong>导入备份</strong><p>合并到现有记录，相同的消息不会重复添加。</p></div><label class="secondary-button file-button">${icon("upload")}导入<input id="import-file" type="file" accept=".json,application/json" hidden></label></div><div class="data-action"><div><strong>清除本次会话中的密钥</strong><p>移除本设备的模型密钥和 GitHub 令牌，聊天记录保留。</p></div><button class="secondary-button" data-action="clear-keys">${icon("key-round")}清除</button></div><p class="quiet-note">本机记录保存在当前浏览器。清理网站数据前，请先同步或导出。每次请求会携带最近 40 条有效消息；长会话可先请角色总结，再开启新会话。</p>`;
}
function download(content, name) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  download(
    JSON.stringify(cleanState(state), null, 2),
    `ai-studio-${new Date().toISOString().slice(0, 10)}.json`,
  );
  toast("已导出备份，不包含密钥");
}
async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (ui.busy || ui.syncBusy) return toast("请等当前生成或同步完成后再导入");
  try {
    if (file.size > 15_000_000) throw new Error("备份超过 15 MB，请拆分后再导入");
    const imported = cleanState(JSON.parse(await file.text()));
    if (bootError) {
      download(localStorage.getItem("ai-studio:data:v1") || "{}", "ai-studio-before-recovery.json");
      saveState(imported);
      state = imported;
      lastSavedState = clone(imported);
      bootError = "";
    } else {
      applyState(mergeStates(state, imported));
      if (!persist()) return;
    }
    render();
    showSettings("data");
    toast("备份已合并");
  } catch (error) {
    toast(error.message || "备份无法读取，原有记录未改动");
  }
}
function editBot(botId) {
  const bot = botId
    ? getBot(botId)
    : {
        name: "",
        description: "",
        prompt: "",
        keywords: "",
        color: "violet",
        icon: "bot",
        providerId: "",
      };
  const dialog = openDialog(
    `${heading(botId ? "编辑角色" : "新建 Bot", "角色指令决定它如何思考；模型决定它使用哪种能力。")}<form id="bot-form"><div class="field-row">${field("角色名称", '<input name="name" required maxlength="50" placeholder="例如：写作助手" value="' + esc(bot.name) + '">')}${field("一句话职责", '<input name="description" maxlength="160" placeholder="它最擅长什么" value="' + esc(bot.description) + '">')}</div>${field("角色指令", '<textarea name="prompt" required rows="7" maxlength="30000" placeholder="描述它的专长、工作原则、输出格式和需要遵守的约束。">' + esc(bot.prompt) + "</textarea>")}${field("擅长的关键词", '<input name="keywords" maxlength="1000" placeholder="用逗号分隔，例如：写作,润色,翻译" value="' + esc(bot.keywords) + '">', "帮助管家判断什么时候邀请这个角色。")}<div class="field-row">${field(
      "使用的模型",
      '<select name="providerId"><option value="">跟随默认模型</option>' +
        providers()
          .map(
            (p) =>
              `<option value="${p.id}" ${bot.providerId === p.id ? "selected" : ""}>${esc(p.name)}</option>`,
          )
          .join("") +
        "</select>",
    )}${field(
      "角色颜色",
      '<select name="color">' +
        [
          ["violet", "紫色"],
          ["teal", "青色"],
          ["blue", "蓝色"],
          ["amber", "金色"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${bot.color === value ? "selected" : ""}>${label}</option>`,
          )
          .join("") +
        "</select>",
    )}</div><div class="form-actions">${botId && botId !== "butler" ? `<button class="danger-button" type="button" data-delete-bot="${bot.id}">${icon("trash-2")}删除角色</button>` : ""}<button class="primary-button" type="submit">${icon("check")}保存角色</button></div></form>`,
    "bot-dialog",
  );
  dialog.querySelector("#bot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const record = {
      id: botId || uid(),
      name: String(form.get("name")).trim(),
      description: String(form.get("description")).trim(),
      prompt: String(form.get("prompt")).trim(),
      keywords: String(form.get("keywords")).trim(),
      providerId: String(form.get("providerId")),
      color: String(form.get("color")),
      icon: bot.icon,
      updatedAt: now(),
      deletedAt: null,
    };
    if (!record.name || !record.prompt) return toast("请填写角色名称和指令");
    if (botId)
      Object.assign(
        state.bots.find((b) => b.id === botId),
        record,
      );
    else state.bots.push(record);
    persist();
    closeDialog();
    render();
    toast("角色已保存");
  });
}
function confirmAction(title, content, action) {
  const dialog = openDialog(
    `${heading(title)}<p class="confirm-copy">${content}</p><div class="form-actions"><button class="secondary-button" data-action="close-dialog">取消</button><button class="danger-solid" id="confirm-action">确认删除</button></div>`,
    "small-dialog",
  );
  dialog.querySelector("#confirm-action").addEventListener("click", () => {
    action();
    closeDialog();
    render();
  });
}
function renameChat() {
  const conversation = currentChat();
  if (!conversation) return;
  const dialog = openDialog(
    `${heading("重命名会话")}<form id="rename-form">${field("会话名称", '<input name="title" required maxlength="160" value="' + esc(conversation.title) + '">')}<div class="form-actions"><button class="primary-button" type="submit">保存</button></div></form>`,
    "small-dialog",
  );
  dialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    conversation.title = new FormData(event.currentTarget).get("title").trim() || "新对话";
    conversation.updatedAt = now();
    persist();
    closeDialog();
    render();
  });
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button,a,label");
  if (!button) return;
  if (button.dataset.action) {
    event.preventDefault();
    const action = button.dataset.action;
    if (action === "new") newChat();
    if (action === "open-sidebar") {
      ui.sidebar = true;
      render();
    }
    if (action === "close-sidebar") {
      ui.sidebar = false;
      render();
    }
    if (action === "settings") showSettings("models");
    if (action === "github-settings") showSettings("github");
    if (action === "close-dialog") closeDialog();
    if (action === "add-bot") editBot();
    if (action === "new-provider") {
      ui.editingProvider = null;
      showSettings("models");
    }
    if (action === "stop") ui.controller?.abort();
    if (action === "sync") runSync();
    if (action === "rename") renameChat();
    if (action === "route-toggle") {
      if (ui.busy) return toast("请先停止当前回答");
      const chat = currentChat(),
        next = mode() === "auto" ? "manual" : "auto";
      if (chat) {
        chat.mode = next;
        chat.updatedAt = now();
        persist();
      } else ui.mode = next;
      ui.forceRoute = next === "auto";
      render();
    }
    if (action === "export") exportBackup();
    if (action === "raw-backup")
      download(localStorage.getItem("ai-studio:data:v1") || "{}", "ai-studio-recovery.json");
    if (action === "disconnect") {
      device.repository = "";
      device.branch = "";
      device.lastSync = "";
      rememberDevice();
      const secrets = getSecrets();
      delete secrets.github;
      setSecrets(secrets);
      ui.syncStatus = "local";
      ui.syncError = "";
      clearTimeout(syncTimer);
      render();
      showSettings("github");
      toast("已断开，聊天记录仍然保留");
    }
    if (action === "clear-keys") {
      clearSecrets();
      showSettings("data");
      toast("本次会话中的密钥已清除");
    }
  }
  if (button.dataset.bot) chooseBot(button.dataset.bot);
  if (button.dataset.editBot) editBot(button.dataset.editBot);
  if (button.dataset.chat) {
    if (ui.busy) return toast("请先停止当前回答");
    ui.activeId = button.dataset.chat;
    ui.sidebar = false;
    ui.draft = "";
    device.activeId = ui.activeId;
    rememberDevice();
    render();
    scrollBottom();
  }
  if (button.dataset.suggestion) {
    ui.draft = button.dataset.suggestion;
    render();
    document.querySelector("#message-input").focus();
  }
  if (button.dataset.tab) {
    event.preventDefault();
    showSettings(button.dataset.tab);
  }
  if (button.dataset.editProvider) {
    ui.editingProvider = button.dataset.editProvider;
    showSettings("models");
  }
  if (button.dataset.deleteProvider) {
    const provider = providers().find((p) => p.id === button.dataset.deleteProvider);
    if (provider)
      confirmAction("删除模型连接？", "角色将改用其他可用模型。聊天记录会保留。", () => {
        provider.deletedAt = now();
        provider.updatedAt = now();
        const secrets = getSecrets();
        if (secrets.models) delete secrets.models[provider.id];
        setSecrets(secrets);
        persist();
      });
  }
  if (button.dataset.deleteBot) {
    const bot = state.bots.find((b) => b.id === button.dataset.deleteBot);
    if (bot && bot.id !== "butler")
      confirmAction("删除这个角色？", "已有聊天会保留，后续对话由管家接手。", () => {
        bot.deletedAt = now();
        bot.updatedAt = now();
        persist();
      });
  }
  if (button.dataset.deleteChat) {
    if (ui.busy) return toast("请先停止当前回答");
    const chat = state.conversations.find((c) => c.id === button.dataset.deleteChat);
    if (chat)
      confirmAction(
        "删除这段对话？",
        "会从列表和其他设备移除。仓库的 Git 历史仍可能保留旧版本。",
        () => {
          chat.deletedAt = now();
          chat.updatedAt = now();
          if (ui.activeId === chat.id) ui.activeId = null;
          persist();
        },
      );
  }
  if (button.dataset.copy) {
    const message = currentChat()?.messages.find((m) => m.id === button.dataset.copy);
    if (message)
      try {
        await navigator.clipboard.writeText(message.content);
        toast("已复制");
      } catch {
        toast("浏览器未允许复制，请选中文字后手动复制");
      }
  }
  if (button.dataset.retry) sendMessage(button.dataset.retry);
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    closeDialog();
    newChat();
  }
  if (event.key === "Escape" && ui.sidebar) {
    ui.sidebar = false;
    render();
  }
});
window.addEventListener("online", () => runSync(false));
window.addEventListener("focus", () => {
  if (!document.querySelector("dialog") && !ui.busy) runSync(false);
});
window.addEventListener("storage", (event) => {
  if (event.key === "ai-studio:data:v1" && event.newValue) {
    try {
      const incoming = cleanState(JSON.parse(event.newValue));
      if (ui.busy) {
        deferredState = deferredState ? mergeStates(deferredState, incoming) : incoming;
        persist();
      } else {
        applyState(mergeStates(state, incoming, lastSavedState));
        persist();
        render();
      }
    } catch {}
  }
});
window.addEventListener("beforeunload", (event) => {
  if (ui.busy || ui.syncBusy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
render();
if (bootError) toast(bootError);
if (device.repository && getSecrets().github?.token) setTimeout(() => runSync(false), 600);

if (document.modelContext?.registerTool) {
  const tools = [
    {
      name: "list_ai_roles",
      description: "列出可用角色，不返回密钥或聊天内容。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        roles: bots().map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
      }),
    },
    {
      name: "select_ai_role",
      description: "在当前聊天界面选择角色，不发送消息或调用模型。",
      inputSchema: {
        type: "object",
        properties: { botId: { type: "string" } },
        required: ["botId"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (!input || typeof input.botId !== "string" || !bots().some((b) => b.id === input.botId))
          throw new Error("未知角色");
        if (ui.busy) throw new Error("请等待当前回答完成");
        chooseBot(input.botId);
        return { selectedBotId: activeBot().id };
      },
    },
  ];
  for (const tool of tools)
    try {
      Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {});
    } catch {}
}
