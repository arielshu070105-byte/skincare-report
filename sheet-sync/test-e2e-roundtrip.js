// 並行驗證期用:真的走一次完整生產路徑(寫Firestore pendingActions → 交給GitHub Actions手動觸發 → 驗證結果),
// 而不是像test-restock.js那樣直接呼叫applyAction()。這支腳本只負責「寫入測試pendingAction」跟「事後檢查+還原」,
// 中間的GitHub Actions觸發由外部(Claude手動`gh workflow run`)完成。
const { getDb, FieldValue } = require("./lib/firestore-client");
const { getSheets, SPREADSHEET_ID } = require("./lib/sheets-client");

async function checkStock(code) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "商品!B2:G40", valueRenderOption: "UNFORMATTED_VALUE" });
  const row = res.data.values.find((r) => r[0] === code);
  return row ? row[5] : null;
}

async function writeTestAction() {
  const db = getDb();
  const ref = await db.collection("pendingActions").add({
    type: "restock",
    code: "小水",
    name: "小瓶化妝水",
    qty: 1,
    date: new Date().toISOString().slice(0, 10),
    synced: false,
    createdAt: FieldValue.serverTimestamp(),
    note: "e2e並行驗證測試,會自動還原",
  });
  console.log("已寫入測試pendingAction,doc id:", ref.id);
  return ref.id;
}

async function checkResult(docId) {
  const db = getDb();
  const doc = await db.collection("pendingActions").doc(docId).get();
  const data = doc.data();
  console.log("pendingAction狀態:", { synced: data.synced, syncedBy: data.syncedBy });
  return data;
}

async function revert(docId) {
  const db = getDb();
  const sheets = getSheets();
  // 用applyAction的邏輯直接反向扣回來(不透過Firestore,因為驗證用途,直接還原試算表數字最乾淨)
  const { applyAction } = require("./lib/apply-action");
  await applyAction({ type: "restock", code: "小水", name: "小瓶化妝水", qty: -1, date: new Date().toISOString().slice(0, 10) });
  await db.collection("pendingActions").doc(docId).delete();
  console.log("已還原庫存並刪除測試pendingAction");
}

const mode = process.argv[2];
if (mode === "write") {
  writeTestAction().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
} else if (mode === "check") {
  checkResult(process.argv[3]).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
} else if (mode === "revert") {
  revert(process.argv[3]).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
} else if (mode === "stock") {
  checkStock("小水").then((v) => console.log("小水目前庫存:", v)).catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
} else {
  console.log("用法: node test-e2e-roundtrip.js write|check <docId>|revert <docId>|stock");
}
