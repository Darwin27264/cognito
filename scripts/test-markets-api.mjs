/**
 * Quick test for /api/markets - run with: node scripts/test-markets-api.mjs
 * Ensure dev server is running (npm run dev) or use full URL.
 */
const base = process.env.API_BASE || "http://localhost:3000";
const url = `${base}/api/markets`;

console.log("Fetching", url);
const start = Date.now();
try {
  const res = await fetch(url);
  const json = await res.json();
  const elapsed = Date.now() - start;
  console.log("Status:", res.status, "| Elapsed:", elapsed + "ms");
  console.log("Data length:", json.data?.length ?? 0);
  if (json.error) console.log("Error from API:", json.error);
  if (json.data?.length) {
    console.log("First item:", JSON.stringify(json.data[0], null, 2));
  } else {
    console.log("Full response:", JSON.stringify(json, null, 2));
  }
} catch (e) {
  console.error("Request failed:", e.message);
}
