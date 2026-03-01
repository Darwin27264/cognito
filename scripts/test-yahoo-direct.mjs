/**
 * Test yahoo-finance2 directly to see errors (no Next server).
 * Run: node scripts/test-yahoo-direct.mjs
 */
import YahooFinance from "yahoo-finance2";

const SYMBOLS = ["CL=F", "GC=F", "^VIX", "DX-Y.NYB", "LMT", "RTX"];

async function main() {
  const yf = new YahooFinance();
  console.log("Testing batch quote(", SYMBOLS, ")...");
  try {
    const quotes = await yf.quote(SYMBOLS, { return: "array" });
    console.log("Batch result: array length =", quotes?.length);
    if (quotes?.length) console.log("First:", JSON.stringify(quotes[0], null, 2));
  } catch (e) {
    console.error("Batch quote error:", e.message);
    console.error("Stack:", e.stack);
  }
  console.log("\nTesting single symbol LMT...");
  try {
    const one = await yf.quote("LMT");
    console.log("Single result:", one ? `${one.symbol} ${one.regularMarketPrice}` : "null");
  } catch (e) {
    console.error("Single quote error:", e.message);
  }
}

main();
