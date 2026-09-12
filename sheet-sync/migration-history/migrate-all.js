const { google } = require("googleapis");
const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

function cellValue(cell) {
  if (cell && typeof cell === "object" && "f" in cell) return cell.f;
  if (cell && typeof cell === "object" && "v" in cell) return cell.v === null || cell.v === undefined ? "" : cell.v;
  return cell === null || cell === undefined ? "" : cell;
}

async function ensureSheet(sheets, title) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    console.log(`created ${title}`);
  } catch (e) {
    if (!String(e.message).includes("already exists")) throw e;
    console.log(`${title} already exists`);
  }
}

async function writeSheet(sheets, title, rawRows) {
  // PowerShell的ConvertTo-Json把每一列(用+=組出來的巢狀陣列)包成{value:[...],Count:N}的形狀,
  // 不是純陣列,這裡統一攤平處理
  const values = rawRows.map((row) => (Array.isArray(row) ? row : row.value).map(cellValue));
  await ensureSheet(sheets, title);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
  console.log(`wrote ${title}: ${values.length} rows`);
}

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  // 商品(用修正過小水價格後重新匯出的版本)
  await writeSheet(sheets, "商品", require("C:/Users/ariel/AppData/Local/Temp/migrate_products.json"));

  // 進貨紀錄(日期欄是原始的Excel序列數字,跟Google Sheets用同一套epoch,數字上相容,
  // 之後可以在Google Sheets那邊自己套用日期格式,不影響數值本身)
  await writeSheet(sheets, "進貨紀錄", require("C:/Users/ariel/AppData/Local/Temp/migrate_restock.json"));

  // 銷售明細
  await writeSheet(sheets, "銷售明細", require("C:/Users/ariel/AppData/Local/Temp/migrate_sales.json"));

  // 種鑽紀錄(含到第50欄的顆數輔助欄,可見欄本來就是民國年文字字串,直接搬過去,
  // Node.js端的日後邏輯會直接解析這些文字,不依賴任何隱藏欄公式)
  await writeSheet(sheets, "種鑽紀錄", require("C:/Users/ariel/AppData/Local/Temp/migrate_diamond.json"));

  // 客戶統計
  await writeSheet(sheets, "客戶統計", require("C:/Users/ariel/AppData/Local/Temp/migrate_customerstats.json"));

  // 薪水(純參考資料,沒有公式邏輯)
  await writeSheet(sheets, "薪水", require("C:/Users/ariel/AppData/Local/Temp/migrate_salary.json"));

  console.log("=== 全部搬遷完成 ===");
}

main().catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
