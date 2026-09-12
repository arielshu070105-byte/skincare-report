// 對應 sync-watcher\apply-action.ps1 的邏輯,搬成用 Google Sheets API 操作雲端試算表
const { getSheets, SPREADSHEET_ID, colToLetter, dateToSerial, serialToMD, dateToRocText } = require("./sheets-client");

// ---- 共用小工具 ----

async function getColumn(sheets, sheetTitle, col, maxRow = 200) {
  const range = `${sheetTitle}!${colToLetter(col)}1:${colToLetter(col)}${maxRow}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range, valueRenderOption: "UNFORMATTED_VALUE" });
  return (res.data.values || []).map((r) => (r.length ? r[0] : ""));
}

async function findRowByValue(sheets, sheetTitle, col, value, maxRow = 200) {
  const colVals = await getColumn(sheets, sheetTitle, col, maxRow);
  for (let i = 1; i < colVals.length; i++) { // 跳過表頭列(index0)
    if (String(colVals[i]).trim() === String(value).trim()) return i + 1; // 轉成1-based列號
  }
  return 0;
}

async function getProductName(sheets, code) {
  const row = await findRowByValue(sheets, "商品", 2, code, 200);
  if (!row) return code;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `商品!C${row}` });
  return (res.data.values && res.data.values[0] && res.data.values[0][0]) || code;
}

// 找/建「進貨紀錄」某一天的日期欄,回傳欄號
async function getTodayColumn(sheets, dateStr) {
  const serial = dateToSerial(dateStr);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "進貨紀錄!1:1", valueRenderOption: "UNFORMATTED_VALUE" });
  const header = (res.data.values && res.data.values[0]) || [];
  for (let c = 2; c < header.length; c++) { // 0-based:col C = index2
    if (Number(header[c]) === serial) return c + 1; // 轉1-based欄號
  }
  const newCol = Math.max(header.length, 2) + 1; // 至少從第3欄(C)開始
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `進貨紀錄!${colToLetter(newCol)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[serial]] },
  });
  return newCol;
}

async function addToRestockColumn(sheets, code, dateStr, delta) {
  const col = await getTodayColumn(sheets, dateStr);
  const row = await findRowByValue(sheets, "進貨紀錄", 1, code, 200);
  if (!row) throw new Error(`進貨紀錄找不到商品代號: ${code}`);
  const cellRange = `進貨紀錄!${colToLetter(col)}${row}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: cellRange, valueRenderOption: "UNFORMATTED_VALUE" });
  const existing = (res.data.values && res.data.values[0] && Number(res.data.values[0][0])) || 0;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: cellRange, valueInputOption: "RAW",
    requestBody: { values: [[existing + delta]] },
  });
}

function newSaleId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${stamp}-${rand}`;
}

async function writeSaleRows(sheets, dateVal, customer, items, saleId) {
  const rows = [];
  for (const item of items) {
    rows.push([dateVal, customer, item.code, item.name, item.qty, item.unitPrice,
      `=IF(AND(E${"{ROW}"}<>"",F${"{ROW}"}<>""),E${"{ROW}"}*F${"{ROW}"},"")`, "手機App", saleId]);
    if (item.isCombo && item.components && item.components.length > 0) {
      for (const comp of item.components) {
        const compQty = item.qty * comp.qty;
        const compName = await getProductName(sheets, comp.code);
        rows.push([dateVal, customer, comp.code, compName, compQty, 0,
          `=IF(AND(E${"{ROW}"}<>"",F${"{ROW}"}<>""),E${"{ROW}"}*F${"{ROW}"},"")`, "手機App(套餐內含)", saleId]);
      }
    }
  }
  // 先用append抓到實際會寫入的起始列號,再把公式裡的{ROW}換成真正列號重寫一次
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "銷售明細!A:A" });
  const startRow = (existing.data.values ? existing.data.values.length : 0) + 1;
  const finalRows = rows.map((row, i) => row.map((v) => (typeof v === "string" && v.includes("{ROW}")) ? v.replaceAll("{ROW}", String(startRow + i)) : v));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: "銷售明細!A:I", valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: finalRows },
  });
}

async function findRowsBySaleId(sheets, saleId) {
  const colVals = await getColumn(sheets, "銷售明細", 9, 2000);
  const rows = [];
  for (let i = 1; i < colVals.length; i++) {
    if (String(colVals[i]).trim() === String(saleId).trim()) rows.push(i + 1);
  }
  return rows.sort((a, b) => b - a); // 由大到小,刪除時才不會讓後面的列號跑掉
}

async function deleteRows(sheets, sheetTitle, rowNumbers) {
  if (rowNumbers.length === 0) return;
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = meta.data.sheets.find((s) => s.properties.title === sheetTitle).properties.sheetId;
  const requests = rowNumbers.map((r) => ({
    deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
}

// ---- Action handlers ----

async function applySale(sheets, action) {
  const dateVal = dateToSerial(action.date);
  const saleId = newSaleId();
  await writeSaleRows(sheets, dateVal, action.customer, action.items, saleId);
}

async function applyDeleteSale(sheets, action) {
  const rows = await findRowsBySaleId(sheets, action.saleId);
  if (rows.length === 0) throw new Error(`找不到銷售ID: ${action.saleId}`);
  await deleteRows(sheets, "銷售明細", rows);
}

async function applyEditSale(sheets, action) {
  const rows = await findRowsBySaleId(sheets, action.saleId);
  await deleteRows(sheets, "銷售明細", rows);
  const dateVal = dateToSerial(action.date);
  await writeSaleRows(sheets, dateVal, action.customer, action.items, action.saleId);
}

async function applyStockAdjust(sheets, action) {
  const row = await findRowByValue(sheets, "商品", 2, action.code, 200);
  if (!row) throw new Error(`商品表找不到代號: ${action.code}`);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `商品!G${row}`, valueRenderOption: "UNFORMATTED_VALUE" });
  const current = (res.data.values && Number(res.data.values[0][0])) || 0;
  const delta = action.targetQty - current;
  await addToRestockColumn(sheets, action.code, action.date, delta);
}

async function applyRestock(sheets, action) {
  await addToRestockColumn(sheets, action.code, action.date, action.qty);
}

async function applyAssembleKit(sheets, action) {
  for (const comp of action.components) {
    const delta = -1 * action.qty * comp.qty;
    await addToRestockColumn(sheets, comp.code, action.date, delta);
  }
  await addToRestockColumn(sheets, action.code, action.date, action.qty);
}

const CHINESE_NUMERALS = ["七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];

async function applyPlantDiamond(sheets, action) {
  const customer = action.customer.trim();
  let row = await findRowByValue(sheets, "種鑽紀錄", 2, customer, 500);
  if (!row) {
    const colB = await getColumn(sheets, "種鑽紀錄", 2, 500);
    row = colB.length + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!B${row}`, valueInputOption: "RAW",
      requestBody: { values: [[customer]] },
    });
  }
  const rocText = dateToRocText(action.date || new Date().toISOString().slice(0, 10));

  if (action.slot === "trial") {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!C${row}`, valueRenderOption: "UNFORMATTED_VALUE" });
    const existing = res.data.values && res.data.values[0] && res.data.values[0][0];
    if (!existing) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!C${row}`, valueInputOption: "RAW",
        requestBody: { values: [[rocText]] },
      });
    }
    return;
  }

  // 找 D~I(第一~六顆)第一個空格
  const rowRange = `種鑽紀錄!D${row}:I${row}`;
  const rowRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: rowRange, valueRenderOption: "UNFORMATTED_VALUE" });
  const rowVals = (rowRes.data.values && rowRes.data.values[0]) || [];
  let slotCol = 0;
  for (let i = 0; i < 6; i++) {
    if (!rowVals[i]) { slotCol = 4 + i; break; }
  }

  if (!slotCol) {
    // 不分輪次往J欄以後延伸
    for (let n = 1; n <= 200; n++) {
      const vc = 9 + n;
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!${colToLetter(vc)}${row}`, valueRenderOption: "UNFORMATTED_VALUE" });
      const existing = res.data.values && res.data.values[0] && res.data.values[0][0];
      if (!existing) {
        slotCol = vc;
        const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!${colToLetter(vc)}1`, valueRenderOption: "UNFORMATTED_VALUE" });
        const headerExisting = headerRes.data.values && headerRes.data.values[0] && headerRes.data.values[0][0];
        if (!headerExisting) {
          const label = n <= CHINESE_NUMERALS.length ? `第${CHINESE_NUMERALS[n - 1]}顆` : `第${n + 6}顆`;
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!${colToLetter(vc)}1`, valueInputOption: "RAW",
            requestBody: { values: [[label]] },
          });
        }
        break;
      }
    }
  }

  if (slotCol) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `種鑽紀錄!${colToLetter(slotCol)}${row}`, valueInputOption: "RAW",
      requestBody: { values: [[rocText]] },
    });
  }
}

async function applyAction(action) {
  const sheets = getSheets();
  switch (action.type) {
    case "sale": return applySale(sheets, action);
    case "deleteSale": return applyDeleteSale(sheets, action);
    case "editSale": return applyEditSale(sheets, action);
    case "stockAdjust": return applyStockAdjust(sheets, action);
    case "restock": return applyRestock(sheets, action);
    case "assembleKit": return applyAssembleKit(sheets, action);
    case "plantDiamond": return applyPlantDiamond(sheets, action);
    default: throw new Error("未知的 action type: " + action.type);
  }
}

module.exports = { applyAction, getProductName, findRowByValue, getColumn, getTodayColumn, addToRestockColumn, deleteRows };
