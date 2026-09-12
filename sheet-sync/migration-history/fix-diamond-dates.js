// 種鑽紀錄的民國年文字("114/10/22")用 USER_ENTERED 寫入時,Google Sheets會自動偵測
// 成日期格式並轉成真正的日期序列值,徹底破壞這套系統依賴的「直接解析可見欄文字」邏輯。
// 這張表完全沒有公式,改用 RAW 模式重寫一次,RAW 模式不會做「智慧型別轉換」,
// 字串會原封不動存成文字,數字(例如第50欄的顆數輔助值)本身在JSON裡就是number型別,
// RAW模式一樣會存成真正的數字,不受影響。
const { google } = require("googleapis");
const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

function cellValue(cell) {
  if (cell && typeof cell === "object" && "f" in cell) return cell.f;
  if (cell && typeof cell === "object" && "v" in cell) return cell.v === null || cell.v === undefined ? "" : cell.v;
  return cell === null || cell === undefined ? "" : cell;
}

async function main() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const raw = require("C:/Users/ariel/AppData/Local/Temp/migrate_diamond.json");
  const values = raw.map((row) => (Array.isArray(row) ? row : row.value).map(cellValue));

  // 單純清值不會清掉已經被誤判成DATE的儲存格格式,乾脆整張分頁刪掉重建,保證沒有殘留格式
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = meta.data.sheets.find((s) => s.properties.title === "種鑽紀錄");
  if (existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] },
    });
    console.log("deleted old 種鑽紀錄 sheet");
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: "種鑽紀錄" } } }] },
  });
  console.log("recreated 種鑽紀錄 sheet");

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "種鑽紀錄!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(`rewrote 種鑽紀錄 with RAW mode: ${values.length} rows`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
