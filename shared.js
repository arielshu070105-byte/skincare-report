export function formatCurrency(n) {
  const v = Number(n) || 0;
  return "NT$ " + Math.round(v).toLocaleString("zh-Hant");
}

export function todayISO() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// innerHTML 組字串前一定要跑過這個,避免客戶名稱等使用者輸入的內容變成可執行的 HTML/腳本
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
