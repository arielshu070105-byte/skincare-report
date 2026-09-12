const { google } = require("googleapis");
const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

function cellValue(cell) {
  if ("f" in cell) return cell.f; // formula string, e.g. "=SUM(...)"
  return cell.v === null || cell.v === undefined ? "" : cell.v;
}

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const raw = require("C:/Users/ariel/AppData/Local/Temp/migrate_products.json");
  const values = raw.map((row) => row.value.map(cellValue));
  console.log(`loaded ${values.length} rows`);

  // 建立「商品」分頁(如果已經存在會失敗,忽略那個錯誤)
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: "商品" } } }] },
    });
    console.log("created 商品 sheet");
  } catch (e) {
    if (!String(e.message).includes("already exists")) throw e;
    console.log("商品 sheet already exists, continuing");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "商品!A1",
    valueInputOption: "USER_ENTERED", // 讓開頭是=的字串被當公式解析
    requestBody: { values },
  });
  console.log("wrote 商品 data");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
