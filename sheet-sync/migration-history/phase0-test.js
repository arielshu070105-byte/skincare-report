// Phase 0驗證腳本:確認service account可以同時讀寫Firestore跟新的Google試算表
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { google } = require("googleapis");
const path = require("path");

const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

async function main() {
  const keyFile = require(KEY_PATH);

  // 1. Firestore 讀寫測試
  const app = initializeApp({ credential: cert(keyFile) }, "phase0test");
  const db = getFirestore(app);
  await db.collection("_migrationTest").doc("phase0").set({
    message: "hello from Node.js phase0 test",
    at: FieldValue.serverTimestamp(),
  });
  const readBack = await db.collection("_migrationTest").doc("phase0").get();
  console.log("Firestore write+read OK:", JSON.stringify(readBack.data()));

  // 2. Google Sheets API 讀寫測試
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // 建一個測試分頁,寫幾格資料,再讀回來確認
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "_phase0test" } } }] },
  }).catch((e) => {
    if (!String(e.message).includes("already exists")) throw e;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "_phase0test!A1:B2",
    valueInputOption: "RAW",
    requestBody: { values: [["hello", "world"], ["測試", 123]] },
  });

  const readSheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "_phase0test!A1:B2",
  });
  console.log("Sheets write+read OK:", JSON.stringify(readSheet.data.values));

  console.log("=== PHASE 0 全部通過 ===");
  process.exit(0);
}

main().catch((e) => {
  console.error("PHASE 0 FAILED:", e.message);
  console.error(e);
  process.exit(1);
});
