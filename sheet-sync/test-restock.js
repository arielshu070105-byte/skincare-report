const { applyAction } = require("./lib/apply-action");
const { getSheets, SPREADSHEET_ID } = require("./lib/sheets-client");

async function checkStock(code) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "商品!B2:G40", valueRenderOption: "UNFORMATTED_VALUE" });
  const row = res.data.values.find((r) => r[0] === code);
  return row ? row[5] : null;
}

async function main() {
  console.log("before:", await checkStock("小水"));
  await applyAction({ type: "restock", code: "小水", name: "小瓶化妝水", qty: 3, date: new Date().toISOString().slice(0, 10) });
  console.log("after +3:", await checkStock("小水"));
  await applyAction({ type: "restock", code: "小水", name: "小瓶化妝水", qty: -3, date: new Date().toISOString().slice(0, 10) });
  console.log("after revert:", await checkStock("小水"));
}
main().catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
