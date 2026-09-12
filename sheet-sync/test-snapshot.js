const { computeSnapshot } = require("./lib/compute-snapshot");

computeSnapshot().then((snap) => {
  console.log("dailyTotals:", JSON.stringify(snap.dailyTotals));
  console.log("salesList count:", snap.salesList.length);
  console.log("diamondCustomers count:", snap.diamondCustomers.length);
  console.log("diamondCustomers top5:", JSON.stringify(snap.diamondCustomers.slice(0, 5).map(c => c.customer + ":" + c.diamondCount)));
  console.log("stockList count:", snap.stockList.length);
  console.log("customerTotals top5:", JSON.stringify(snap.customerTotals.slice(0, 5)));
}).catch((e) => { console.error("FAILED:", e.message, e); process.exit(1); });
