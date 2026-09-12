// GitHub Actions排程執行的進入點,對應本機 sync-watcher.js 的 syncCycle() 邏輯,
// 差別是這裡是「跑一次就結束」(排程本身負責定期重新觸發),不是常駐輪詢迴圈。
const { getDb, FieldValue } = require("./lib/firestore-client");
const { applyAction } = require("./lib/apply-action");
const { computeSnapshot } = require("./lib/compute-snapshot");

async function syncPendingActions() {
  const db = getDb();
  const snap = await db.collection("pendingActions").where("synced", "==", false).get();
  if (snap.empty) {
    console.log("沒有新的待同步紀錄");
    return;
  }
  console.log(`發現 ${snap.size} 筆待同步紀錄`);
  for (const doc of snap.docs) {
    const action = doc.data();
    // 遷移並行驗證期間,本機sync-watcher.js跟這支GitHub Actions腳本可能同時在跑,
    // 用交易「認領」這筆動作,確保同一筆pendingActions不會被兩邊都處理到一次
    // (先讀+後寫分開做的話會有競爭空間,交易內讀寫在Firestore端是原子的)
    let claimed = false;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists || fresh.data().synced) return;
        tx.update(doc.ref, { synced: true, syncedAt: FieldValue.serverTimestamp(), syncedBy: "github-actions" });
        claimed = true;
      });
    } catch (e) {
      console.error(`  ✗ 認領失敗,下次再試: ${action.type} (${doc.id}): ${e.message}`);
      continue;
    }
    if (!claimed) {
      console.log(`  - 已被另一套同步程式處理過,跳過: ${action.type} (${doc.id})`);
      continue;
    }
    try {
      await applyAction(action);
      console.log(`  ✓ 已同步: ${action.type} (${doc.id})`);
    } catch (e) {
      // 已經認領(synced:true)但實際套用失敗——這種情況不會自動重試,先記錄下來,
      // 之後可以手動查Firestore裡 syncedBy:"github-actions" 但實際結果沒生效的紀錄來補救
      console.error(`  ✗ 已認領但套用失敗,需要人工確認: ${action.type} (${doc.id})`);
      console.error("    " + e.message);
    }
  }
}

async function pushSnapshot() {
  const db = getDb();
  const data = await computeSnapshot();
  await db.collection("performanceSnapshot").doc("latest").set({
    dailyTotals: data.dailyTotals || [],
    salesList: data.salesList || [],
    diamondCustomers: data.diamondCustomers || [],
    stockList: data.stockList || [],
    customerTotals: data.customerTotals || [],
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ 績效資料已更新(${data.dailyTotals.length} 天,${data.salesList.length} 筆銷售紀錄,${data.diamondCustomers.length} 位種鑽客戶,${data.stockList.length} 項商品庫存,${data.customerTotals.length} 位客戶總計)`);
}

async function main() {
  console.log(`[${new Date().toISOString()}] sheet-sync 開始執行`);
  try {
    await syncPendingActions();
  } catch (e) {
    console.error("syncPendingActions 發生錯誤:", e.message);
  }
  try {
    await pushSnapshot();
  } catch (e) {
    console.error("pushSnapshot 發生錯誤:", e.message);
    process.exitCode = 1; // 讓GitHub Actions這次執行顯示失敗,方便發現問題
  }
  console.log(`[${new Date().toISOString()}] sheet-sync 執行完畢`);
}

main();
