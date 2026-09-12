const { applyAction } = require("./lib/apply-action");
const { getSheets, SPREADSHEET_ID } = require("./lib/sheets-client");

async function checkStocks(codes) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "商品!B2:G40", valueRenderOption: "UNFORMATTED_VALUE" });
  const out = {};
  for (const code of codes) {
    const row = res.data.values.find((r) => r[0] === code);
    out[code] = row ? row[5] : null;
  }
  return out;
}

const kit = { code: "4+5+6", name: "維生素C三件套裝(1set)", components: [{ code: "4號", qty: 1 }, { code: "5號", qty: 1 }, { code: "6號-1", qty: 1 }] };
const codes = ["4+5+6", "4號", "5號", "6號-1"];

async function main() {
  console.log("before:", JSON.stringify(await checkStocks(codes)));
  await applyAction({ ...kit, type: "assembleKit", qty: 2, date: new Date().toISOString().slice(0, 10) });
  console.log("after assemble x2:", JSON.stringify(await checkStocks(codes)));
  await applyAction({ ...kit, type: "assembleKit", qty: -2, date: new Date().toISOString().slice(0, 10) });
  console.log("after disassemble x2 (revert):", JSON.stringify(await checkStocks(codes)));
}
main().catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
