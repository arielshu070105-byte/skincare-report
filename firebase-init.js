import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

export const LS_CONFIG = "beautyreport_firebase_config";

export const DEFAULT_CONFIG = null;

export function loadConfig() {
  if (DEFAULT_CONFIG) return DEFAULT_CONFIG;
  try {
    const saved = localStorage.getItem(LS_CONFIG);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* fall through to null */ }
  return null;
}

export function saveConfig(configObj) {
  localStorage.setItem(LS_CONFIG, JSON.stringify(configObj));
}

// 找出貼上文字裡每一個平衡的 { ... } 區塊,挑含有 "apiKey" 的那個
export function extractConfigObjectText(raw) {
  const candidates = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < raw.length; j++) {
      if (raw[j] === "{") depth++;
      else if (raw[j] === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(raw.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return candidates.find((c) => c.includes("apiKey")) || candidates[candidates.length - 1] || null;
}

export function parseConfigInput(raw) {
  const jsonish = extractConfigObjectText(raw);
  if (!jsonish) {
    throw new Error("找不到 { ... } 設定物件,請確認貼上的內容包含 firebaseConfig");
  }
  let configObj;
  try {
    // eslint-disable-next-line no-new-func
    configObj = Function(`"use strict"; return (${jsonish});`)();
  } catch (e) {
    throw new Error("無法解析貼上的內容,請確認是完整的 firebaseConfig 物件\n\n" + e.message);
  }
  if (!configObj || !configObj.apiKey || !configObj.projectId) {
    throw new Error("這個設定物件缺少必要欄位(apiKey / projectId),請重新確認貼上內容");
  }
  return configObj;
}

export function initFirebase(configObj) {
  const app = initializeApp(configObj);
  return { app, db: getFirestore(app), auth: getAuth(app) };
}
