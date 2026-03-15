import { useState, useEffect, useCallback, useRef } from "react";

export interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  positive: boolean;
}

const MARKET_SYMBOLS = ["BTC-USD", "ETH-USD", "ALEO-USD"] as const;
const COINGECKO_IDS: Record<typeof MARKET_SYMBOLS[number], string> = {
  "BTC-USD": "bitcoin",
  "ETH-USD": "ethereum",
  "ALEO-USD": "aleo",
};
const BINANCE_SYMBOLS: Partial<Record<typeof MARKET_SYMBOLS[number], string>> = {
  "BTC-USD": "BTCUSDT",
  "ETH-USD": "ETHUSDT",
};
const MEXC_SYMBOLS: Partial<Record<typeof MARKET_SYMBOLS[number], string>> = {
  "ALEO-USD": "ALEOUSDT",
};
const PRICE_CACHE_KEY = "autoperp:prices:cache:v1";
const WS_SYMBOL_TO_MARKET: Record<string, string> = {
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
};

function defaultPrices(): MarketPrice[] {
  return [
    { symbol: "BTC-USD", price: 0, change24h: 0, positive: true },
    { symbol: "ETH-USD", price: 0, change24h: 0, positive: true },
    { symbol: "ALEO-USD", price: 0, change24h: 0, positive: false },
  ];
}

function loadCachedPrices(): MarketPrice[] {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return defaultPrices();
    const parsed = JSON.parse(raw) as MarketPrice[];
    if (!Array.isArray(parsed)) return defaultPrices();
    const normalized = MARKET_SYMBOLS.map((symbol) => {
      const row = parsed.find((p) => p.symbol === symbol);
      if (!row || !Number.isFinite(row.price)) {
        return defaultPrices().find((p) => p.symbol === symbol)!;
      }
      return {
        symbol,
        price: Number(row.price) || 0,
        change24h: Number(row.change24h) || 0,
        positive: Number(row.change24h) >= 0,
      };
    });
    return normalized;
  } catch {
    return defaultPrices();
  }
}

function persistPrices(next: MarketPrice[]) {
  try {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

const formatPrice = (price: number): string => {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
};

const usePrices = () => {
  const [prices, setPrices] = useState<MarketPrice[]>(() => loadCachedPrices());
  const [loading, setLoading] = useState(() => !loadCachedPrices().some((p) => p.price > 0));
  const errorCountRef = useRef(0);

  const fetchPrices = useCallback(async () => {
    try {
      const nextBySymbol: Record<string, { price: number; change24h: number }> = {};

      // 1) Fast path: Binance ticker (near real-time for listed pairs).
      const binancePairs = MARKET_SYMBOLS
        .map((symbol) => BINANCE_SYMBOLS[symbol])
        .filter((value): value is string => Boolean(value));

      if (binancePairs.length > 0) {
        const query = encodeURIComponent(JSON.stringify(binancePairs));
        const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`);
        if (bRes.ok) {
          const bRows = (await bRes.json()) as Array<{ symbol?: string; lastPrice?: string; priceChangePercent?: string }>;
          const byPair: Record<string, { price: number; change24h: number }> = {};
          for (const row of bRows) {
            const sym = String(row.symbol ?? "").toUpperCase();
            const price = Number(row.lastPrice ?? 0);
            const change24h = Number(row.priceChangePercent ?? 0);
            if (!sym || !Number.isFinite(price) || price <= 0) continue;
            byPair[sym] = { price, change24h: Number.isFinite(change24h) ? change24h : 0 };
          }

          for (const market of MARKET_SYMBOLS) {
            const pair = BINANCE_SYMBOLS[market];
            if (!pair) continue;
            const data = byPair[pair];
            if (!data) continue;
            nextBySymbol[market] = data;
          }
        }
      }

      // 1b) ALEO fast path: MEXC ticker.
      const aleoMexc = MEXC_SYMBOLS["ALEO-USD"];
      if (aleoMexc) {
        const mRes = await fetch(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${aleoMexc}`);
        if (mRes.ok) {
          const mRow = (await mRes.json()) as { lastPrice?: string; priceChangePercent?: string };
          const price = Number(mRow.lastPrice ?? 0);
          const change24h = Number(mRow.priceChangePercent ?? 0);
          if (Number.isFinite(price) && price > 0) {
            nextBySymbol["ALEO-USD"] = {
              price,
              change24h: Number.isFinite(change24h) ? change24h : 0,
            };
          }
        }
      }

      // 2) Fallback/fill: CoinGecko for anything missing from Binance.
      const missing = MARKET_SYMBOLS.filter((symbol) => !nextBySymbol[symbol]);
      if (missing.length > 0) {
        const ids = missing.map((symbol) => COINGECKO_IDS[symbol]).join(",");
        const cgRes = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        );
        if (cgRes.ok) {
          const cgPayload = await cgRes.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
          for (const symbol of missing) {
            const row = cgPayload[COINGECKO_IDS[symbol]] ?? {};
            const price = Number(row.usd ?? 0);
            const change24h = Number(row.usd_24h_change ?? 0);
            if (!Number.isFinite(price) || price <= 0) continue;
            nextBySymbol[symbol] = {
              price,
              change24h: Number.isFinite(change24h) ? change24h : 0,
            };
          }
        }
      }

      const updated: MarketPrice[] = MARKET_SYMBOLS.map((symbol) => {
        const fresh = nextBySymbol[symbol];
        if (fresh) {
          return {
            symbol,
            price: fresh.price,
            change24h: fresh.change24h,
            positive: fresh.change24h >= 0,
          };
        }
        return null as unknown as MarketPrice;
      });

      setPrices((prev) => {
        const merged = updated.map((row, idx) => {
          if (row && Number.isFinite(row.price) && row.price > 0) return row;
          return prev[idx] ?? defaultPrices()[idx];
        });

        persistPrices(merged);
        return merged;
      });
      setLoading(false);
      errorCountRef.current = 0;
    } catch (err) {
      if (errorCountRef.current < 3) {
        console.error("Price fetch error:", err);
      }
      errorCountRef.current++;
      // Keep last known good prices if fetch fails.
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const streams = ["btcusdt@miniTicker", "ethusdt@miniTicker"].join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data) as {
          data?: { s?: string; c?: string; P?: string };
        };
        const sym = String(packet?.data?.s ?? "").toUpperCase();
        const market = WS_SYMBOL_TO_MARKET[sym];
        if (!market) return;

        const price = Number(packet?.data?.c ?? 0);
        const change24h = Number(packet?.data?.P ?? 0);
        if (!Number.isFinite(price) || price <= 0) return;

        setPrices((prev) => {
          const next = prev.map((row) =>
            row.symbol === market
              ? {
                  ...row,
                  price,
                  change24h: Number.isFinite(change24h) ? change24h : row.change24h,
                  positive: Number.isFinite(change24h) ? change24h >= 0 : row.positive,
                }
              : row,
          );
          persistPrices(next);
          return next;
        });

        setLoading(false);
      } catch {
        // ignore malformed packets
      }
    };

    return () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 2000); // every 2s
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const getPrice = (symbol: string) => prices.find((p) => p.symbol === symbol);

  return { prices, loading, getPrice, formatPrice };
};

export { formatPrice };
export default usePrices;
