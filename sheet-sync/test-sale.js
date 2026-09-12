const { applyAction } = require("./lib/apply-action");
const { getSheets, SPREADSHEET_ID } = require("./lib/sheets-client");

async function getLastSalesRows(n) {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "銷售明細!A2:I200", valueRenderOption: "UNFORMATTED_VALUE" });
  const rows = res.data.values || [];
  return rows.slice(-n);
}

async function main() {
  const before = await getLastSalesRows(3);
  console.log("before (last 3):", JSON.stringify(before));

  // 測試sale(含尾差,模擬真實登記銷售場景)
  await applyAction({
    type: "sale", customer: "測試客戶", date: new Date().toISOString().slice(0, 10),
    items: [
      { code: "小水", name: "小瓶化妝水", qty: 2, unitPrice: 150, isCombo: false, components: null },
      { code: "尾差", name: "尾差", qty: 1, unitPrice: -10, isCombo: false, components: null },
    ],
  });
  const afterSale = await getLastSalesRows(3);
  console.log("after sale:", JSON.stringify(afterSale));
  const saleId = afterSale[afterSale.length - 1][8];
  console.log("saleId:", saleId);

  // 測試editSale
  await applyAction({
    type: "editSale", saleId, customer: "測試客戶(改)", date: new Date().toISOString().slice(0, 10),
    items: [{ code: "小藍", name: "小瓶活顏噴霧", qty: 1, unitPrice: 150, isCombo: false, components: null }],
  });
  const afterEdit = await getLastSalesRows(3);
  console.log("after editSale:", JSON.stringify(afterEdit));

  // 測試deleteSale(清乾淨)
  await applyAction({ type: "deleteSale", saleId, date: new Date().toISOString().slice(0, 10) });
  const afterDelete = await getLastSalesRows(3);
  console.log("after deleteSale (should be back to original):", JSON.stringify(afterDelete));
}
main().catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
