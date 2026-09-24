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
    note: "已预填官方接口；模型名称可修改",
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
