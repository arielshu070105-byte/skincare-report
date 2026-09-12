const { google } = require("googleapis");
const path = require("path");

const KEY_PATH = path.join(__dirname, "..", "..", "sync-watcher", "serviceAccountKey.json");
const SPREADSHEET_ID = "18ObXU201avqpZHQVjqMAZqb70UaXSjztqIA0iD8Ng1U";

let _sheets = null;
function getSheets() {
  if (_sheets) return _sheets;
  // GitHub Actions會把service account JSON內容放進環境變數FIREBASE_SERVICE_ACCOUNT,
  // 本機測試則直接讀sync-watcher資料夾裡現有的那把金鑰檔案(跟 firestore-client.js 同一套規則)
  const authOptions = { scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    authOptions.credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    authOptions.keyFile = KEY_PATH;
  }
  const auth = new google.auth.GoogleAuth(authOptions);
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

// 欄號(1-based) -> A1欄字母,例如 1->A, 27->AA
function colToLetter(col) {
  let s = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

const EPOCH_UTC_MS = Date.UTC(1899, 11, 30); // Excel/Sheets共用的epoch(1899-12-30)
function dateToSerial(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC_MS) / 86400000);
}
function serialToMD(serial) {
  const dt = new Date(EPOCH_UTC_MS + serial * 86400000);
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}
function dateToRocText(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y - 1911}/${m}/${d}`;
}

module.exports = { getSheets, SPREADSHEET_ID, colToLetter, dateToSerial, serialToMD, dateToRocText, EPOCH_UTC_MS };
