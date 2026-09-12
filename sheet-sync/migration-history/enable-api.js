const { google } = require("googleapis");
const KEY_PATH = "C:/Users/ariel/Desktop/保養品回報/sync-watcher/serviceAccountKey.json";

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const serviceusage = google.serviceusage({ version: "v1", auth });
  const res = await serviceusage.services.enable({
    name: "projects/charis-inventory/services/sheets.googleapis.com",
  });
  console.log("enable result:", JSON.stringify(res.data));
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
