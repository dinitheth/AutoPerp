import { useEffect, useMemo, useState } from "react";
import usePrices, { formatPrice } from "@/hooks/usePrices";
import { cn } from "@/lib/utils";

type Level = { price: number; size: number };
type TradeRow = { price: number; size: number; side: "buy" | "sell"; time: string };

const COINBASE_PRODUCTS: Record<string, string | null> = {
  "BTC-USD": "BTC-USD",
  "ETH-USD": "ETH-USD",
  "SOL-USD": "SOL-USD",
  // Coinbase spot order book may not exist for ALEO-USD; we will fall back to synthetic levels.
  "ALEO-USD": null,
};

function toNum(s: unknown): number {
  const n = typeof s === "string" ? Number(s) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) ? n : 0;
}

function syntheticBook(mid: number): { bids: Level[]; asks: Level[] } {
  if (!Number.isFinite(mid) || mid <= 0) return { bids: [], asks: [] };
  const step = mid * 0.0005; // 5 bps
  const mk = (i: number) => Math.max(0.00000001, mid + i * step);
  const levels = Array.from({ length: 12 }, (_, i) => i + 1);
  const bids: Level[] = levels.map((i) => ({
    price: mk(-i),
    size: Math.max(0.01, (1 / i) * 2),
  }));
  const asks: Level[] = levels.map((i) => ({
    price: mk(i),
    size: Math.max(0.01, (1 / i) * 2),
  }));
  return { bids, asks };
}

export default function OrderBook({ market }: { market: string }) {
  const { getPrice } = usePrices();
  const mid = getPrice(market)?.price ?? 0;
  const product = COINBASE_PRODUCTS[market] ?? null;

  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [loading, setLoading] = useState(false);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchBook = async () => {
      if (!product) {
        const syn = syntheticBook(mid);
        if (!alive) return;
        setBids(syn.bids);
        setAsks(syn.asks);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/book?level=2`);
        if (!res.ok) throw new Error("book fetch failed");
        const data = (await res.json()) as { bids?: unknown[]; asks?: unknown[] };
        const parse = (rows: unknown[] | undefined, dir: "bids" | "asks"): Level[] => {
          const out: Level[] = [];
          for (const r of rows ?? []) {
            if (!Array.isArray(r)) continue;
            const price = toNum(r[0]);
            const size = toNum(r[1]);
            if (price <= 0 || size <= 0) continue;
            out.push({ price, size });
          }
          out.sort((a, b) => (dir === "bids" ? b.price - a.price : a.price - b.price));
          return out.slice(0, 12);
        };
        const nbids = parse(data.bids as unknown[], "bids");
        const nasks = parse(data.asks as unknown[], "asks");
        if (!alive) return;
        setBids(nbids);
        setAsks(nasks);
      } catch {
        const syn = syntheticBook(mid);
        if (!alive) return;
        setBids(syn.bids);
        setAsks(syn.asks);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchBook();
    const i = setInterval(fetchBook, 6000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [product, mid]);

  useEffect(() => {
    let alive = true;

    const syntheticTrades = (m: number): TradeRow[] => {
      if (!Number.isFinite(m) || m <= 0) return [];
      const now = Date.now();
      return Array.from({ length: 18 }, (_, i) => {
        const t = new Date(now - i * 3500).toISOString();
        const side: "buy" | "sell" = i % 2 === 0 ? "buy" : "sell";
        const price = Math.max(0.00000001, m * (1 + (side === "buy" ? -1 : 1) * (i + 1) * 0.00007));
        const size = Math.max(0.001, 0.05 * (1 / (i + 1)));
        return { price, size, side, time: t };
      });
    };

    const fetchTrades = async () => {
      if (!product) {
        const syn = syntheticTrades(mid);
        if (!alive) return;
        setTrades(syn);
        return;
      }

      setLoadingTrades(true);
      try {
        const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/trades?limit=30`);
        if (!res.ok) throw new Error("trades fetch failed");
        const data = (await res.json()) as Array<{ price?: string; size?: string; side?: string; time?: string }>;
        const out: TradeRow[] = [];
        for (const r of data ?? []) {
          const price = toNum(r.price);
          const size = toNum(r.size);
          const side = r.side === "sell" ? "sell" : "buy";
          const time = typeof r.time === "string" ? r.time : new Date().toISOString();
          if (price <= 0 || size <= 0) continue;
          out.push({ price, size, side, time });
        }
        if (!alive) return;
        setTrades(out.slice(0, 16));
      } catch {
        const syn = syntheticTrades(mid);
        if (!alive) return;
        setTrades(syn.slice(0, 16));
      } finally {
        if (alive) setLoadingTrades(false);
      }
    };

    fetchTrades();
    const i = setInterval(fetchTrades, 4000);
    return () => {
      alive = false;
      clearInterval(i);
    };
  }, [product, mid]);

  const spread = useMemo(() => {
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    if (bestBid <= 0 || bestAsk <= 0) return null;
    return bestAsk - bestBid;
  }, [bids, asks]);

  const selectPrice = (price: number) => {
    window.dispatchEvent(new CustomEvent("autoperp:orderbook-price", { detail: { price } }));
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="h-full p-3 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-foreground">Order Book</p>
        <p className="text-[10px] text-muted-foreground font-mono">
          {loading ? "Loading..." : spread !== null ? `Spread $${formatPrice(spread)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 min-h-0 flex-1">
        <div className="min-h-0 flex flex-col">
          <p className="text-[10px] text-muted-foreground mb-1">Bids</p>
          <div className="space-y-1 min-h-0 overflow-auto pr-1 flex-1">
            {bids.slice(0, 10).map((l) => (
              <button
                key={`b-${l.price}`}
                onClick={() => selectPrice(l.price)}
                className={cn(
                  "w-full flex items-center justify-between rounded-md px-2 py-1 text-[10px] font-mono border border-border bg-secondary hover:bg-secondary/70 transition-colors",
                )}
              >
                <span className="text-success">${formatPrice(l.price)}</span>
                <span className="text-muted-foreground">{l.size.toFixed(4)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex flex-col">
          <p className="text-[10px] text-muted-foreground mb-1">Asks</p>
          <div className="space-y-1 min-h-0 overflow-auto pr-1 flex-1">
            {asks.slice(0, 10).map((l) => (
              <button
                key={`a-${l.price}`}
                onClick={() => selectPrice(l.price)}
                className={cn(
                  "w-full flex items-center justify-between rounded-md px-2 py-1 text-[10px] font-mono border border-border bg-secondary hover:bg-secondary/70 transition-colors",
                )}
              >
                <span className="text-destructive">${formatPrice(l.price)}</span>
                <span className="text-muted-foreground">{l.size.toFixed(4)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-2 text-[9px] text-muted-foreground">
        Click a level to prefill Limit Price.
      </p>

      <div className="mt-3 pt-3 border-t border-border flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-foreground">Trades</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {loadingTrades ? "Loading..." : trades.length ? `${trades.length} recent` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 text-[10px] text-muted-foreground font-mono mb-1 px-2">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
        </div>

        <div className="space-y-1 overflow-auto pr-1 min-h-0 flex-1">
          {trades.map((t, idx) => (
            <button
              key={`${t.time}-${idx}`}
              onClick={() => selectPrice(t.price)}
              className="w-full grid grid-cols-3 items-center rounded-md px-2 py-0.5 text-[10px] font-mono border border-border bg-secondary hover:bg-secondary/70 transition-colors"
            >
              <span className={cn(t.side === "buy" ? "text-success" : "text-destructive")}>
                ${formatPrice(t.price)}
              </span>
              <span className="text-right text-muted-foreground">{t.size.toFixed(4)}</span>
              <span className="text-right text-muted-foreground">{fmtTime(t.time)}</span>
            </button>
          ))}

          {trades.length === 0 && (
            <div className="text-center text-xs text-muted-foreground py-6">No trades.</div>
          )}
        </div>
      </div>
    </div>
  );
}
