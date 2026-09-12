const { applyAction, deleteRows, findRowByValue } = require("./lib/apply-action");
const { getSheets, SPREADSHEET_ID } = require("./lib/sheets-client");

async function getRow(customer) {
  const sheets = getSheets();
  const row = await findRowByValue(sheets, "種鑽紀錄", 2, customer, 500);
  if (!row) return null;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!A${row}:P${row}`, valueRenderOption: "UNFORMATTED_VALUE" });
  return { row, values: res.data.values[0] };
}

async function cleanup() {
  const sheets = getSheets();
  const row = await findRowByValue(sheets, "種鑽紀錄", 2, "測試種鑽客戶", 500);
  if (row) {
    await deleteRows(sheets, "種鑽紀錄", [row]);
    console.log("已清除測試客戶列(row " + row + ")");
  }
}

async function run() {
  const today = new Date().toISOString().slice(0, 10);

  // 1. 全新客人 - trial
  await applyAction({ type: "plantDiamond", customer: "測試種鑽客戶", date: today, slot: "trial" });
  console.log("after trial:", JSON.stringify(await getRow("測試種鑽客戶")));

  // 2. 種第一顆
  await applyAction({ type: "plantDiamond", customer: "測試種鑽客戶", date: today });
  console.log("after 1st:", JSON.stringify(await getRow("測試種鑽客戶")));

  // 3. 重複trial(應該不會改變,已經有體驗了)
  await applyAction({ type: "plantDiamond", customer: "測試種鑽客戶", date: "2020-01-01", slot: "trial" });
  console.log("after duplicate trial attempt (should be unchanged):", JSON.stringify(await getRow("測試種鑽客戶")));

  // 4. 種滿6顆再種第7顆(測試動態延伸)
  for (let i = 0; i < 5; i++) {
    await applyAction({ type: "plantDiamond", customer: "測試種鑽客戶", date: today });
  }
  console.log("after filling to 6:", JSON.stringify(await getRow("測試種鑽客戶")));
  await applyAction({ type: "plantDiamond", customer: "測試種鑽客戶", date: today }); // 第7顆
  console.log("after 7th (dynamic extend):", JSON.stringify(await getRow("測試種鑽客戶")));

  const sheets = getSheets();
  const header = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "種鑽紀錄!J1", valueRenderOption: "UNFORMATTED_VALUE" });
  console.log("col J header (should be 第七顆):", JSON.stringify(header.data.values));
}

async function main() {
  // 用try/finally包住:就算中途炸掉(例如API配額暫時超過),也一定會清掉測試客戶列,
  // 不會把半成品的測試資料留在正式試算表裡(之前的版本沒做這步,曾經真的留了好幾天沒被發現)
  try {
    await run();
  } finally {
    await cleanup().catch((e) => console.error("清除失敗,需要人工檢查『測試種鑽客戶』這一列:", e.message));
  }
}
main().catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
