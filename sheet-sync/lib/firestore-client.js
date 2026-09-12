const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

let _db = null;
function getDb() {
  if (_db) return _db;
  // GitHub Actions會把service account JSON內容放進環境變數FIREBASE_SERVICE_ACCOUNT,
  // 本機測試則直接讀sync-watcher資料夾裡現有的那把金鑰檔案
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    credential = cert(require("C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json"));
  }
  const app = initializeApp({ credential });
  _db = getFirestore(app);
  return _db;
}

module.exports = { getDb, FieldValue };
