/**
 * Test dashboard APIs - run with: node scripts/test-apis.mjs
 * Start the Next.js dev server first: npm run dev
 */
const BASE = "http://localhost:3000";

async function test(name, url, opts = {}) {
  try {
    const res = await fetch(`${BASE}${url}`, opts);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 300) };
    }
    const ok = res.ok ? "✓" : "✗";
    console.log(`\n${ok} ${name} (${res.status})`);
    if (data.error) console.log("  error:", data.error);
    if (data.message) console.log("  message:", data.message);
    if (Array.isArray(data.fires)) console.log("  fires count:", data.fires.length);
    if (Array.isArray(data.sensors)) console.log("  sensors count:", data.sensors?.length ?? 0);
    if (Array.isArray(data.articles)) console.log("  articles count:", data.articles?.length ?? 0);
    if (Array.isArray(data.events)) console.log("  events count:", data.events?.length ?? 0);
    if (data.data && Array.isArray(data.data)) console.log("  data length:", data.data.length);
    if (data.flights && Array.isArray(data.flights)) console.log("  flights count:", data.flights.length);
    if (data.ships && Array.isArray(data.ships)) console.log("  ships count:", data.ships.length);
    return { ok: res.ok, data };
  } catch (err) {
    console.log(`\n✗ ${name} FAIL:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log("Testing Cognitio APIs at", BASE);
  await test("Fires (NASA FIRMS)", "/api/fires");
  await test("Radiation (Safecast)", "/api/radiation?bmax=90,180&bmin=-90,-180");
  await test("Intel (News)", "/api/intel");
  await test("GDELT events", "/api/gdelt");
  await test("Seismic", "/api/seismic");
  await test("Markets", "/api/markets");
  console.log("\nDone.");
}

main();
