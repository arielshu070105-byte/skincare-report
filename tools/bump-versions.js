// 自動幫 index.html 裡 import 這幾個檔案的 ?v= 版本號,換成該檔案目前內容算出來的雜湊值。
// 內容只要有任何改動,雜湊值就會自動跟著變,不用再靠人工記得手動把版本號+1
// (這是2026-09-26 CHARIS 保養品回報網頁「忘記加版本號,手機看不到新內容」這個老問題的根本解法)。
// 這支腳本會被 .git/hooks/pre-commit 在每次commit前自動呼叫,不需要手動執行,
// 但也可以直接 `node tools/bump-versions.js` 手動跑一次確認結果。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const INDEX_HTML = path.join(ROOT, "index.html");
const VERSIONED_FILES = ["firebase-init.js", "shared.js", "products-seed.js", "combos-seed.js"];

function shortHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function main() {
  let html = fs.readFileSync(INDEX_HTML, "utf8");
  let changed = false;
  for (const fileName of VERSIONED_FILES) {
    const filePath = path.join(ROOT, fileName);
    if (!fs.existsSync(filePath)) { console.error(`  ⚠ 找不到檔案,跳過: ${fileName}`); continue; }
    const hash = shortHash(filePath);
    const pattern = new RegExp(`(\\./${fileName.replace(".", "\\.")})\\?v=[A-Za-z0-9]+`, "g");
    const before = html;
    html = html.replace(pattern, `$1?v=${hash}`);
    if (html !== before) {
      changed = true;
      console.log(`  ✓ ${fileName} -> ?v=${hash}`);
    }
  }
  if (changed) {
    fs.writeFileSync(INDEX_HTML, html);
    console.log("index.html 已更新版本號");
  } else {
    console.log("版本號沒有變化(內容都沒改動或已經是最新雜湊值)");
  }
}

main();
