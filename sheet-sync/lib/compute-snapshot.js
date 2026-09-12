// 對應 sync-watcher\compute-performance.ps1 的邏輯,搬成Node.js
const { getSheets, SPREADSHEET_ID, colToLetter, EPOCH_UTC_MS } = require("./sheets-client");

function serialToIso(serial) {
  const dt = new Date(EPOCH_UTC_MS + serial * 86400000);
  return dt.toISOString().slice(0, 10);
}

function rocTextToDate(rocText) {
  if (!rocText) return null;
  const parts = String(rocText).trim().split("/");
  if (parts.length !== 3) return null;
  const rocYear = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!rocYear || !month || !day) return null;
  const adYear = rocYear + 1911;
  const dt = new Date(Date.UTC(adYear, month - 1, day));
  if (isNaN(dt.getTime())) return null;
  return dt;
}
function dateToIso(dt) { return dt.toISOString().slice(0, 10); }

async function computeSnapshot() {
  const sheets = getSheets();

  // ---- 商品:rvByCode + stockList ----
  const prodRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "商品!A1:J200", valueRenderOption: "UNFORMATTED_VALUE" });
  const prodRows = prodRes.data.values || [];
  const rvByCode = {};
  const stockList = [];
  for (let i = 1; i < prodRows.length; i++) {
    const r = prodRows[i];
    const threshold = r[5]; // F欄
    if (!threshold && threshold !== 0) continue; // 跳過分類標題列/空白列
    const code = r[1], name = r[2], rv = Number(r[3]) || 0, stock = Number(r[6]) || 0;
    rvByCode[code] = rv;
    stockList.push({ code, name, stock });
  }

  // ---- 銷售明細:dailyTotals, salesList, totalsByCustomer ----
  const salesRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "銷售明細!A1:I5000", valueRenderOption: "UNFORMATTED_VALUE" });
  const salesRows = salesRes.data.values || [];
  const totalsByDate = {};
  const rvByDate = {};
  const totalsByCustomer = {};
  const groups = new Map(); // saleId -> {id,date,customer,items,total}
  for (let i = 1; i < salesRows.length; i++) {
    const r = salesRows[i];
    const dateVal = r[0];
    if (!dateVal && dateVal !== 0) continue;
    const subtotal = Number(r[6]) || 0;
    const dateKey = serialToIso(Number(dateVal));
    totalsByDate[dateKey] = (totalsByDate[dateKey] || 0) + subtotal;

    const code = r[2], name = r[3], qty = r[4], source = r[7] || "", customer = r[1], saleId = r[8];
    const rowRV = code && rvByCode[code] != null && qty ? rvByCode[code] * Number(qty) : 0;
    rvByDate[dateKey] = (rvByDate[dateKey] || 0) + rowRV;

    if (customer) {
      const custKey = String(customer).trim();
      if (custKey) totalsByCustomer[custKey] = (totalsByCustomer[custKey] || 0) + subtotal;
    }

    if (saleId) {
      if (!groups.has(saleId)) groups.set(saleId, { id: saleId, date: dateKey, customer, items: [], total: 0 });
      const g = groups.get(saleId);
      g.total += subtotal;
      if (!String(source).includes("套餐內含") && code) g.items.push({ code, name, qty });
    }
  }
  const dailyTotals = Object.keys(totalsByDate).sort().map((date) => ({
    date, total: Math.round(totalsByDate[date]), rv: Math.round(rvByDate[date] || 0),
  }));
  const salesList = [...groups.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 50)
    .map((g) => ({ id: g.id, date: g.date, customer: g.customer, items: g.items, total: Math.round(g.total) }));

  // ---- 種鑽紀錄 ----
  const dRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "種鑽紀錄!A1:BC500", valueRenderOption: "UNFORMATTED_VALUE" });
  const dRows = dRes.data.values || [];
  const slotDefs = [
    { label: "體驗", col: 3 }, { label: "第一顆", col: 4 }, { label: "第二顆", col: 5 },
    { label: "第三顆", col: 6 }, { label: "第四顆", col: 7 }, { label: "第五顆", col: 8 }, { label: "第六顆", col: 9 },
  ];
  // 動態偵測額外欄位(J欄=10起),跟原本邏輯一樣:遇到「表頭跟所有列都沒資料」的欄位就停止
  const header = dRows[0] || [];
  let extraN = 1;
  while (true) {
    const vc = 9 + extraN; // 1-based欄號
    const idx = vc - 1;
    const extraLabel = header[idx];
    let colHasData = false;
    for (let r = 1; r < dRows.length; r++) { if (dRows[r] && dRows[r][idx]) { colHasData = true; break; } }
    if (!extraLabel && !colHasData) break;
    slotDefs.push({ label: extraLabel || `第${extraN + 6}顆`, col: vc });
    extraN++;
    if (extraN > 200) break;
  }

  const diamondRows = [];
  const reminderUpdates = []; // {row, value}
  const countUpdates = []; // {row, value}
  for (let r = 1; r < dRows.length; r++) {
    const row = dRows[r] || [];
    const customer = row[1]; // B欄
    if (!customer) continue;
    let diamondCount = 0;
    for (const def of slotDefs) { if (def.label === "體驗") continue; if (row[def.col - 1]) diamondCount++; }
    const hasTrial = !!row[2]; // C欄

    let maxDate = null;
    const slots = [];
    for (const def of slotDefs) {
      const rocText = row[def.col - 1];
      const slotDate = rocTextToDate(rocText);
      let sDateIso = null;
      if (slotDate) {
        sDateIso = dateToIso(slotDate);
        if (!maxDate || slotDate > maxDate) maxDate = slotDate;
      }
      if (def.col <= 9 || sDateIso) slots.push({ label: def.label, date: sDateIso });
    }

    let lastDateIso = null, isDue = false;
    if (maxDate) {
      lastDateIso = dateToIso(maxDate);
      const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
      isDue = Math.floor((todayUtc - maxDate) / 86400000) >= 30;
    }

    const reminderText = isDue ? "🔔 該提醒種鑽" : "";
    if ((row[0] || "") !== reminderText) reminderUpdates.push({ row: r + 1, value: reminderText });
    if (Number(row[49]) !== diamondCount) countUpdates.push({ row: r + 1, value: diamondCount }); // col50 = index49

    diamondRows.push({ customer, diamondCount, hasTrial, lastDate: lastDateIso, isDue, slots });
  }

  // 寫回提醒/顆數(批次寫入,只有真的有差異的列才會出現在這裡)
  if (reminderUpdates.length || countUpdates.length) {
    const data = [
      ...reminderUpdates.map((u) => ({ range: `種鑽紀錄!A${u.row}`, values: [[u.value]] })),
      ...countUpdates.map((u) => ({ range: `種鑽紀錄!${colToLetter(50)}${u.row}`, values: [[u.value]] })),
    ];
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: "RAW", data },
      });
    }
  }

  // 檢查顆數欄現在的物理列順序是否已經降序排好,沒排好才真的動手排序
  let alreadySorted = true, prevCount = null;
  for (const d of diamondRows) {
    if (prevCount !== null && d.diamondCount > prevCount) { alreadySorted = false; break; }
    prevCount = d.diamondCount;
  }
  if (!alreadySorted) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetId = meta.data.sheets.find((s) => s.properties.title === "種鑽紀錄").properties.sheetId;
    const lastRow = dRows.length;
    const lastCol = Math.max(50, header.length);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          sortRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: lastRow, startColumnIndex: 0, endColumnIndex: lastCol },
            sortSpecs: [{ dimensionIndex: 49, sortOrder: "DESCENDING" }], // col50 = index49
          },
        }],
      },
    });
  }

  const diamondCustomers = diamondRows.sort((a, b) => {
    if (b.diamondCount !== a.diamondCount) return b.diamondCount - a.diamondCount;
    if (b.hasTrial !== a.hasTrial) return (b.hasTrial ? 1 : 0) - (a.hasTrial ? 1 : 0);
    const ad = a.lastDate || "", bd = b.lastDate || "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.customer).localeCompare(String(b.customer));
  });

  // ---- 客戶統計 ----
  const statRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "客戶統計!A1:E500", valueRenderOption: "UNFORMATTED_VALUE" });
  const statRows = statRes.data.values || [];
  const existingNames = new Set();
  for (let r = 1; r < statRows.length; r++) { if (statRows[r] && statRows[r][0]) existingNames.add(String(statRows[r][0]).trim()); }

  const newRows = [];
  for (const custName of Object.keys(totalsByCustomer)) {
    if (existingNames.has(custName)) continue;
    const rowNum = statRows.length + 1 + newRows.length;
    newRows.push({ range: `客戶統計!A${rowNum}:D${rowNum}`, values: [[custName, "", `=SUMIF(銷售明細!B:B,A${rowNum},銷售明細!G:G)`, `=B${rowNum}+C${rowNum}`]] });
    existingNames.add(custName);
  }
  let statChanged = newRows.length > 0;
  if (newRows.length) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data: newRows } });
  }

  // 重新讀一次(含新增的列)取得最新D欄數值,順便檢查排序
  const statRes2 = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "客戶統計!A1:E500", valueRenderOption: "UNFORMATTED_VALUE" });
  const statRows2 = statRes2.data.values || [];
  let statSorted = true, prevVal = null;
  for (let r = 1; r < statRows2.length; r++) {
    const v = Number(statRows2[r][3]) || 0;
    if (prevVal !== null && v > prevVal) { statSorted = false; break; }
    prevVal = v;
  }
  if (statChanged || !statSorted) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetId = meta.data.sheets.find((s) => s.properties.title === "客戶統計").properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          sortRange: {
            range: { sheetId, startRowIndex: 1, endRowIndex: statRows2.length, startColumnIndex: 0, endColumnIndex: 5 },
            sortSpecs: [{ dimensionIndex: 3, sortOrder: "DESCENDING" }],
          },
        }],
      },
    });
  }

  const statRes3 = statChanged || !statSorted
    ? await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "客戶統計!A1:E500", valueRenderOption: "UNFORMATTED_VALUE" })
    : statRes2;
  const statRows3 = statRes3.data.values || [];
  const customerTotals = [];
  for (let r = 1; r < statRows3.length; r++) {
    const row = statRows3[r];
    if (!row || !row[0]) continue;
    customerTotals.push({ customer: String(row[0]).trim(), total: Math.round(Number(row[3]) || 0), isVip: !!row[4] });
  }

  return { dailyTotals, salesList, diamondCustomers, stockList, customerTotals };
}

module.exports = { computeSnapshot };
