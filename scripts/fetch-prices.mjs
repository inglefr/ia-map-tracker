import { writeFile, readFile } from "node:fs/promises";

const TICKERS_PATH = new URL("../data/tickers.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/prices.json", import.meta.url);

const scope = process.argv[2] || "all"; // "level1" | "level2" | "all"

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=10d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Pas de donnée renvoyée");
  const meta = result.meta;

  const closes = (result.indicators?.quote?.[0]?.close || []).filter(
    (c) => c != null
  );
  if (closes.length < 2) throw new Error("Pas assez d'historique");

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const price = meta.regularMarketPrice ?? lastClose;
  const changePct = ((price - prevClose) / prevClose) * 100;

  return {
    price: Number(price.toFixed(2)),
    previousClose: Number(prevClose.toFixed(2)),
    changePct: Number(changePct.toFixed(2)),
    currency: meta.currency || null,
  };
}

function collectLevel1Entries(tickers) {
  const out = [];
  for (const node of tickers.chain) {
    if (node.type === "ellipse") continue;
    for (const c of node.companies || []) out.push(c);
    for (const c of node.extra || []) out.push(c);
    for (const c of node.secondOrder || []) out.push(c);
  }
  return out;
}

function collectLevel2Entries(tickers) {
  const out = [];
  for (const branch of tickers.branches) {
    for (const c of branch.companies || []) out.push(c);
  }
  return out;
}

async function fetchForEntries(entries, results) {
  let ok = 0;
  let failed = 0;
  for (const entry of entries) {
    if (!entry.ticker) {
      results[entry.id] = { available: false, reason: "non_cotee" };
      continue;
    }
    try {
      const quote = await fetchQuote(entry.ticker);
      results[entry.id] = { available: true, ...quote };
      ok++;
    } catch (err) {
      results[entry.id] = {
        available: false,
        reason: "fetch_error",
        error: String(err.message || err),
      };
      failed++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok, failed };
}

async function main() {
  const tickers = JSON.parse(await readFile(TICKERS_PATH, "utf-8"));

  let existing = { updatedAtLevel1: null, updatedAtLevel2: null, quotes: {} };
  try {
    existing = JSON.parse(await readFile(OUTPUT_PATH, "utf-8"));
    if (!existing.quotes) existing.quotes = {};
  } catch {
    // pas de fichier existant, on part de zéro
  }

  const now = new Date().toISOString();
  let totalOk = 0;
  let totalFailed = 0;

  if (scope === "level1" || scope === "all") {
    const entries = collectLevel1Entries(tickers);
    const { ok, failed } = await fetchForEntries(entries, existing.quotes);
    existing.updatedAtLevel1 = now;
    totalOk += ok;
    totalFailed += failed;
  }

  if (scope === "level2" || scope === "all") {
    const entries = collectLevel2Entries(tickers);
    const { ok, failed } = await fetchForEntries(entries, existing.quotes);
    existing.updatedAtLevel2 = now;
    totalOk += ok;
    totalFailed += failed;
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(existing, null, 2));
  console.log(`Scope: ${scope} — Terminé : ${totalOk} cours récupérés, ${totalFailed} échecs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
