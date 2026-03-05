/**
 * Quick test of NASA FIRMS API - run with: node scripts/test-firms-api.mjs
 */
const base = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
// Test 1: invalid key - see what NASA returns
const invalidKeyUrl = `${base}/INVALID_KEY_TEST/VIIRS_SNPP_NRT/world/1`;
console.log("1. Testing NASA FIRMS with invalid key...");
const r1 = await fetch(invalidKeyUrl, {
  headers: { "User-Agent": "Cognitio-Test/1.0", Accept: "text/csv, */*" },
});
console.log("   Status:", r1.status, r1.statusText);
const text1 = await r1.text();
console.log("   Body (first 400 chars):", JSON.stringify(text1.slice(0, 400)));
console.log("   Body starts with {:", text1.trim().startsWith("{"));
console.log("   Body starts with <:", text1.trim().startsWith("<"));
console.log("");

// Test 2: no key in path (empty) - some APIs return different errors
const noKeyUrl = `${base}//VIIRS_SNPP_NRT/world/1`;
console.log("2. Testing NASA FIRMS with empty key segment...");
const r2 = await fetch(noKeyUrl, {
  headers: { "User-Agent": "Cognitio-Test/1.0" },
});
console.log("   Status:", r2.status);
const text2 = await r2.text();
console.log("   Body (first 300 chars):", JSON.stringify(text2.slice(0, 300)));
console.log("");

// Test 3: hit our Next.js API (if server running) - optional
console.log("3. To test local /api/fires, run: curl \"http://localhost:3000/api/fires?west=-180&south=-90&east=180&north=90\"");
process.exit(0);
