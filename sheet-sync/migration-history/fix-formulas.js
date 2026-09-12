// 修正遷移時因為引用的分頁還沒建立而卡死成#REF!的公式(Google Sheets不會自動在分頁
// 建立後重新解析已經寫入的公式,要重寫一次才會生效)
const { google } = require("googleapis");
const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  // 商品 G欄(2..38列)
  const prodFormulas = [];
  for (let r = 2; r <= 38; r++) {
    prodFormulas.push([`=SUM(進貨紀錄!C${r}:ZZ${r})-SUMIF(銷售明細!C:C,B${r},銷售明細!E:E)`]);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: "商品!G2:G38", valueInputOption: "USER_ENTERED",
    requestBody: { values: prodFormulas },
  });
  console.log("fixed 商品 G2:G38");

  // 客戶統計 C欄(2..48列) — 銷售明細已經先建立,但保險起見一起重寫確保沒問題
  const custFormulas = [];
  for (let r = 2; r <= 48; r++) {
    custFormulas.push([`=SUMIF(銷售明細!B:B,A${r},銷售明細!G:G)`]);
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: "客戶統計!C2:C48", valueInputOption: "USER_ENTERED",
    requestBody: { values: custFormulas },
  });
  console.log("fixed 客戶統計 C2:C48");

  console.log("=== 公式修復完成 ===");
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
