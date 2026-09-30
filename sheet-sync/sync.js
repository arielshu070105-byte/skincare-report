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

// 2026-09-30發現的重大bug:這支腳本每次被cron-job.org觸發(~1分鐘一次)都會無條件把這裡算出來
// 的資料蓋掉Firestore performanceSnapshot/latest,但這裡的資料是從Google試算表算出來的,而
// Google試算表**不是**Excel的完整鏡像(本機處理的動作,例如組裝/拆解套組,不會回寫進Google試算
// 表——這是Phase 4/5並行架構本來就知道、記錄過的單向落差)。結果變成:本機系統剛把正確資料寫進
// Firestore,不到1分鐘後這支腳本就用試算表裡過時的資料蓋回去,跟本機系統自己的30秒週期互相拉扯,
// 造成手機看到規律性的「跳回舊資料又自動修正」——一整天原本以為是COM連線不穩定,後來才找到真正
// 原因是這裡。
// 修法:寫入前先看現有snapshot的updatedAt夠不夠新——如果很新(代表本機系統本來就活著、剛更新過,
// Excel是比Google試算表更完整、更即時的資料來源),就不要用這裡算出來的(可能不完整的)資料蓋過
// 去;只有現有資料已經過期(代表本機系統這段期間沒在跑,電腦可能沒開機),才輪到這份雲端算出來的
// 資料當安全網頂上去。門檻抓90秒,比本機30秒週期留寬裕的緩衝,又比GitHub Actions排程本身的執行
// 間隔短很多,不會誤判。
const LOCAL_FRESH_THRESHOLD_MS = 90 * 1000;

async function pushSnapshot() {
  const db = getDb();
  const existing = await db.collection("performanceSnapshot").doc("latest").get();
  if (existing.exists && existing.data().updatedAt) {
    const ageMs = Date.now() - existing.data().updatedAt.toDate().getTime();
    if (ageMs < LOCAL_FRESH_THRESHOLD_MS) {
      console.log(`  - 現有績效資料${Math.round(ageMs / 1000)}秒前才更新過(本機系統顯然還活著),Excel資料比Google試算表更完整,這次不覆蓋`);
      return;
    }
  }
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
