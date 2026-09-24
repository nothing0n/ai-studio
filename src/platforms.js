export const OPENAI_DEFAULT = {
  id: "openai-default",
  name: "ChatGPT / OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4",
  updatedAt: "2026-09-24T00:00:00.000Z",
  deletedAt: null,
};
export const DEFAULT_REPOSITORY = "nothing0n/ai-studio-data";
export const API_PLATFORMS = [
  {
    name: "OpenAI / ChatGPT",
    keys: "https://platform.openai.com/api-keys",
    docs: "https://developers.openai.com/api/docs/models/gpt-5.4",
    note: "选择模型后填写密钥即可；也可读取账号可用模型",
  },
  {
    name: "DeepSeek",
    keys: "https://platform.deepseek.com/api_keys",
    docs: "https://api-docs.deepseek.com/",
    note: "OpenAI 兼容接口",
  },
  {
    name: "Google Gemini",
    keys: "https://aistudio.google.com/apikey",
    docs: "https://ai.google.dev/gemini-api/docs/openai",
    note: "使用 Gemini 的 OpenAI 兼容地址",
  },
  {
    name: "Anthropic Claude",
    keys: "https://platform.claude.com/settings/keys",
    docs: "https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk",
    note: "官方兼容层主要用于测试比较，部分功能受限",
  },
  {
    name: "xAI Grok",
    keys: "https://console.x.ai/team/default/api-keys",
    docs: "https://docs.x.ai/developers/model-capabilities/legacy/chat-completions",
    note: "Chat Completions 为旧版接口",
  },
  {
    name: "通义千问 / 阿里百炼",
    keys: "https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key",
    docs: "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
    note: "密钥与接口需选择相同地域",
  },
  {
    name: "Moonshot Kimi",
    keys: "https://platform.kimi.com/console/api-keys",
    docs: "https://platform.kimi.com/docs/get-api-key",
    note: "OpenAI 兼容接口",
  },
];

const connections = [
  {
    id: "openai",
    endpoints: [["官方", "https://api.openai.com/v1"]],
    models: [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
    ],
    dashboard: "https://platform.openai.com/usage",
    billing: "https://platform.openai.com/account/billing",
  },
  {
    id: "deepseek",
    endpoints: [["官方", "https://api.deepseek.com"]],
    aliases: ["https://api.deepseek.com/v1"],
    models: ["deepseek-flash", "deepseek-v4-pro"],
    dashboard: "https://platform.deepseek.com/",
    balance: "deepseek",
  },
  {
    id: "gemini",
    endpoints: [["官方兼容接口", "https://generativelanguage.googleapis.com/v1beta/openai"]],
    models: ["gemini-3.8-flash"],
    dashboard: "https://aistudio.google.com/",
  },
  {
    id: "claude",
    endpoints: [["官方兼容接口", "https://api.anthropic.com/v1"]],
    models: ["claude-sonnet-4-6"],
    dashboard: "https://platform.claude.com/",
    discovery: false,
  },
  {
    id: "xai",
    endpoints: [["官方", "https://api.x.ai/v1"]],
    models: ["grok-4.7"],
    dashboard: "https://console.x.ai/",
  },
  {
    id: "qwen",
    endpoints: [
      ["中国内地 · 北京", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
      ["国际 · 新加坡", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ],
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    dashboard: "https://bailian.console.aliyun.com/",
  },
  {
    id: "kimi",
    endpoints: [
      ["中国", "https://api.moonshot.cn/v1"],
      ["国际", "https://api.moonshot.ai/v1"],
    ],
    models: ["kimi-k2.6"],
    dashboard: "https://platform.kimi.com/console",
    balance: "kimi",
  },
];
export const PLATFORM_PRESETS = API_PLATFORMS.map((platform, index) => ({
  ...platform,
  ...connections[index],
}));
export const CUSTOM_PLATFORM = {
  id: "custom",
  name: "自定义 OpenAI 兼容接口",
  endpoints: [],
  models: [],
  note: "填写自定义地址后，可从接口读取模型列表",
};
export function platformFor(baseUrl = "") {
  const normalized = String(baseUrl).replace(/\/+$/, "");
  return (
    PLATFORM_PRESETS.find((platform) =>
      [...platform.endpoints.map((entry) => entry[1]), ...(platform.aliases || [])].includes(
        normalized,
      ),
    ) || CUSTOM_PLATFORM
  );
}
export function chatModelIds(ids, platformId) {
  return [
    ...new Set(
      ids.filter(
        (id) =>
          typeof id === "string" &&
          id.length > 0 &&
          id.length <= 160 &&
          !/[\u0000-\u001f]/.test(id),
      ),
    ),
  ]
    .filter(
      (id) =>
        platformId !== "openai" ||
        (/^(?:gpt-[456]|o[134])/.test(id) &&
          !/(?:embedding|tts|whisper|image|audio|realtime|transcri|codex|search|(?:^|-)pro(?:-|$))/.test(
            id,
          )),
    )
    .filter((id) => platformId !== "kimi" || !/^kimi-k3/.test(id))
    .sort((a, b) => a.localeCompare(b));
}
