import { platformFor } from "./platforms.js";

export const TOKEN_LIMITS = [1024, 2048, 4096, 8192, 16384, 32768];
export const TEMPERATURES = [0.2, 0.7, 1];
export const REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export function cleanModelOptions(raw = {}) {
  return {
    maxTokens: TOKEN_LIMITS.includes(raw.maxTokens) ? raw.maxTokens : null,
    temperature: TEMPERATURES.includes(raw.temperature) ? raw.temperature : null,
    reasoning: REASONING_LEVELS.includes(raw.reasoning) ? raw.reasoning : "auto",
    streaming: raw.streaming !== false,
  };
}

export function modelCapabilities(provider) {
  const platform = platformFor(provider.baseUrl),
    model = provider.model || "";
  const openaiReasoning =
    platform.id === "openai" && /^(gpt-[56]|o[134])/.test(model) && !/chat-latest/.test(model);
  const supportsNone = /^gpt-5\.[245]|^gpt-6-(?:sol|luna)/.test(model);
  const reasoning = openaiReasoning
    ? [
        ...(supportsNone ? ["none"] : []),
        "low",
        "medium",
        "high",
        ...(/^gpt-(?:5\.[45]|6)/.test(model) ? ["xhigh"] : []),
        ...(/^gpt-6/.test(model) ? ["max"] : []),
      ]
    : [];
  const temperature =
    !["kimi", "deepseek", "claude"].includes(platform.id) &&
    !/^gpt-5\.5/.test(model) &&
    (!openaiReasoning || (supportsNone && provider.options?.reasoning === "none"));
  return { reasoning, temperature };
}

export function requestOptions(provider, stream) {
  const options = cleanModelOptions(provider.options),
    platform = platformFor(provider.baseUrl);
  const capabilities = modelCapabilities({ ...provider, options }),
    result = {};
  if (options.maxTokens !== null)
    result[platform.id === "openai" ? "max_completion_tokens" : "max_tokens"] = options.maxTokens;
  if (options.temperature !== null && capabilities.temperature)
    result.temperature = options.temperature;
  if (capabilities.reasoning.includes(options.reasoning))
    result.reasoning_effort = options.reasoning;
  if (platform.id === "kimi" && /^kimi-k2(?:\.|$)/.test(provider.model))
    result.thinking = { type: "disabled" };
  if (stream && ["openai", "deepseek", "qwen", "gemini", "kimi", "xai"].includes(platform.id))
    result.stream_options = { include_usage: true };
  return result;
}
