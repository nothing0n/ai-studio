import { initialState, cleanState } from "./data.js";

const DATA_KEY = "ai-studio:data:v1";
const DEVICE_KEY = "ai-studio:device:v1";
const SECRET_KEY = "ai-studio:session-secrets:v1";
export function loadState() {
  const raw = localStorage.getItem(DATA_KEY);
  if (!raw) return initialState();
  const state = cleanState(JSON.parse(raw));
  for (const chat of state.conversations)
    for (const message of chat.messages)
      if (message.status === "streaming") {
        message.status = "interrupted";
        message.error = "上次生成被中断，已保留收到的内容";
      }
  return state;
}
export function saveState(state) {
  localStorage.setItem(DATA_KEY, JSON.stringify(cleanState(state)));
}
export function loadDevice() {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY)) || {};
  } catch {
    return {};
  }
}
export function saveDevice(value) {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(value));
}
export function getSecrets() {
  try {
    return JSON.parse(sessionStorage.getItem(SECRET_KEY)) || { models: {} };
  } catch {
    return { models: {} };
  }
}
export function setSecrets(value) {
  sessionStorage.setItem(SECRET_KEY, JSON.stringify(value));
}
export function clearSecrets() {
  sessionStorage.removeItem(SECRET_KEY);
}
export function hasUnsavedStorage() {
  return !navigator.onLine;
}
