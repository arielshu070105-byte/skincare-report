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

// 一次對多個商品代號疊加寫入「進貨紀錄」當天欄位,用bulk read/一次batchUpdate取代「每個代號各自
// 找欄+找列+讀值+寫值」(原本套組拆裝一次要動十幾個品項,等於十幾個代號各打4次API,很容易連續
// 呼叫撞到Sheets API的每分鐘配額)。不管deltasByCode裡有幾個代號,固定只需要3次讀取API呼叫
// (找當天欄位、讀整欄代號、讀當天欄位現有值)+最多2次寫入(新增日期欄表頭、批次寫回所有異動格)。
async function addDeltasToRestockColumn(sheets, deltasByCode, dateStr) {
  const codes = Object.keys(deltasByCode).filter((c) => deltasByCode[c]);
  if (codes.length === 0) return;
  const col = await getTodayColumn(sheets, dateStr);
  const codeCol = await getColumn(sheets, "進貨紀錄", 1, 200);
  const existingCol = await getColumn(sheets, "進貨紀錄", col, 200);
  const dataForBatch = [];
  for (const code of codes) {
    const rowIdx = codeCol.findIndex((v, i) => i > 0 && String(v).trim() === String(code).trim());
    if (rowIdx === -1) throw new Error(`進貨紀錄找不到商品代號: ${code}`);
    const row = rowIdx + 1; // 轉1-based列號
    const existing = Number(existingCol[rowIdx]) || 0;
    dataForBatch.push({ range: `進貨紀錄!${colToLetter(col)}${row}`, values: [[existing + deltasByCode[code]]] });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: "RAW", data: dataForBatch },
  });
}

async function addToRestockColumn(sheets, code, dateStr, delta) {
  await addDeltasToRestockColumn(sheets, { [code]: delta }, dateStr);
}

function newSaleId() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${stamp}-${rand}`;
}

async function writeSaleRows(sheets, dateVal, customer, items, saleId) {
  // 套餐內含品項要各自查商品名稱——原本一個一個comp呼叫getProductName(各自findRowByValue+讀名稱,
  // 2次API呼叫),10件組這種十幾樣內含品項的套組一次要打20幾次。改成先一次bulk讀整個商品B:C欄
  // (代號+名稱)建成對照表,不管套組裡有幾樣內含品項都只需要這1次額外呼叫。
  const hasCombo = items.some((it) => it.isCombo && it.components && it.components.length > 0);
  let nameByCode = null;
  if (hasCombo) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "商品!B2:C200", valueRenderOption: "UNFORMATTED_VALUE" });
    nameByCode = {};
    for (const r of res.data.values || []) { if (r[0]) nameByCode[String(r[0]).trim()] = r[1] || r[0]; }
  }
  const rows = [];
  for (const item of items) {
    rows.push([dateVal, customer, item.code, item.name, item.qty, item.unitPrice,
      `=IF(AND(E${"{ROW}"}<>"",F${"{ROW}"}<>""),E${"{ROW}"}*F${"{ROW}"},"")`, "手機App", saleId]);
    if (item.isCombo && item.components && item.components.length > 0) {
      for (const comp of item.components) {
        const compQty = item.qty * comp.qty;
        const compName = (nameByCode && nameByCode[String(comp.code).trim()]) || comp.code;
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
  const deltas = {};
  for (const comp of action.components) {
    deltas[comp.code] = (deltas[comp.code] || 0) + -1 * action.qty * comp.qty;
  }
  deltas[action.code] = (deltas[action.code] || 0) + action.qty;
  await addDeltasToRestockColumn(sheets, deltas, action.date);
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
    // 不分輪次往J欄以後延伸——原本每一欄分開讀(逐欄「有沒有值」+「表頭有沒有值」各一次API呼叫),
    // 客戶種很多顆時最壞情況會连續打到快400次API呼叫,很容易撞到Sheets API的每分鐘讀取配額。
    // 改成一次用batchGet把「資料列」跟「表頭列」一段寬範圍一起讀回來,在記憶體裡找第一個空格,
    // 不管要延伸到多遠,固定只需要1次讀取(+最多2次寫入),對應compute-performance.ps1當初改成
    // bulk read的同一個效能守則。
    const maxExtend = 200;
    const dataRange = `種鑽紀錄!${colToLetter(10)}${row}:${colToLetter(9 + maxExtend)}${row}`;
    const headerRange = `種鑽紀錄!${colToLetter(10)}1:${colToLetter(9 + maxExtend)}1`;
    const batchRes = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID, ranges: [dataRange, headerRange], valueRenderOption: "UNFORMATTED_VALUE",
    });
    const dataVals = (batchRes.data.valueRanges[0].values && batchRes.data.valueRanges[0].values[0]) || [];
    const headerVals = (batchRes.data.valueRanges[1].values && batchRes.data.valueRanges[1].values[0]) || [];
    for (let n = 1; n <= maxExtend; n++) {
      if (!dataVals[n - 1]) {
        const vc = 9 + n;
        slotCol = vc;
        const headerExisting = headerVals[n - 1];
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
