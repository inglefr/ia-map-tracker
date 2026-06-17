import { writeFile, readFile } from "node:fs/promises";

const TICKERS_PATH = new URL("../data/tickers.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/prices.json", import.meta.url);

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

  // On ne se fie pas aux champs meta.previousClose / chartPreviousClose : sur cet
  // endpoint ils référencent parfois la clôture d'avant TOUTE la période demandée
  // (donc plusieurs jours en arrière), pas la veille. On reconstruit la variation
  // à partir des deux dernières clôtures journalières réelles, ce qui est fiable.
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

async function main() {
  const tickers = JSON.parse(await readFile(TICKERS_PATH, "utf-8"));
  const results = {};
  let ok = 0;
  let failed = 0;

  for (const entry of tickers) {
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
    // petite pause pour ne pas surcharger l'API
    await new Promise((r) => setTimeout(r, 250));
  }

  const output = {
    updatedAt: new Date().toISOString(),
    quotes: results,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Terminé : ${ok} cours récupérés, ${failed} échecs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
