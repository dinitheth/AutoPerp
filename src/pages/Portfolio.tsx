import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";
import WalletGate from "@/components/wallet/WalletGate";
import useUsdcxBalance from "@/hooks/useUsdcxBalance";
import usePrices from "@/hooks/usePrices";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { PROGRAMS } from "@/hooks/useAleoTransaction";
import { PRIVATE_CORE_PROGRAM } from "@/lib/protocol";
import { cn } from "@/lib/utils";
import { parseAleoPositionRecord } from "@/lib/positionRecord";
import { requestProgramRecordsAny } from "@/lib/walletRecords";
import {
  addEquityPoint,
  loadEquity,
  loadOrders,
  loadTrades,
  type PortfolioEquityPoint,
  type PortfolioOrder,
  type PortfolioTradeEvent,
} from "@/lib/portfolioStore";

type TabKey =
  | "balances"
  | "positions"
  | "open_orders"
  | "trade_history"
  | "funding_history"
  | "order_history";

type ChartMode = "account" | "pnl";

interface PositionRow {
  id: string;
  market: string;
  direction: "long" | "short";
  collateralUsd: number;
  leverage: number;
  sizeUsd: number;
  entry: number;
  mark: number;
  pnlUsd: number;
  roePct: number;
}

const PORTFOLIO_POSITIONS_CACHE_KEY = "autoperp:portfolio:positions-cache";
const TRADE_POSITIONS_SNAPSHOT_KEY = "autoperp:positions:snapshot";

function scopedKey(base: string, address?: string | null): string {
  const scope = (address ?? "").trim().toLowerCase() || "guest";
  return `${base}:${scope}`;
}

const TAKER_FEE_PCT = 0.045;
const MAKER_FEE_PCT = 0.015;

const MARKET_NAMES: Record<string, string> = {
  "0": "BTC-USD",
  "1": "ETH-USD",
  "2": "ALEO-USD",
};

const POSITION_RECORD_PROGRAM_CANDIDATES = [
  PROGRAMS.CORE,
  PRIVATE_CORE_PROGRAM,
  "autoperp_core_v5.aleo",
];

function n2(raw: string | null | undefined): number {
  const n = parseFloat(raw ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdCompact(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}k`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatNum(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function loadCachedPositions(address?: string | null): PositionRow[] {
  try {
    const raw = localStorage.getItem(scopedKey(PORTFOLIO_POSITIONS_CACHE_KEY, address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PositionRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCachedPositions(rows: PositionRow[], address?: string | null) {
  try {
    localStorage.setItem(scopedKey(PORTFOLIO_POSITIONS_CACHE_KEY, address), JSON.stringify(rows));
  } catch {
    // no-op
  }
}

function loadTradePositionsSnapshot(address?: string | null): PositionRow[] {
  try {
    const raw = localStorage.getItem(scopedKey(TRADE_POSITIONS_SNAPSHOT_KEY, address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{
      id: string;
      market: string;
      direction: "long" | "short";
      collateral: number;
      leverage: number;
      size: number;
      entryPrice: number;
      markPrice: number;
      pnl: number;
      pnlPercent: number;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      id: p.id,
      market: p.market,
      direction: p.direction,
      collateralUsd: Number.isFinite(p.collateral) ? p.collateral : 0,
      leverage: Number.isFinite(p.leverage) ? p.leverage : 0,
      sizeUsd: Number.isFinite(p.size) ? p.size : 0,
      entry: Number.isFinite(p.entryPrice) ? p.entryPrice : 0,
      mark: Number.isFinite(p.markPrice) ? p.markPrice : 0,
      pnlUsd: Number.isFinite(p.pnl) ? p.pnl : 0,
      roePct: Number.isFinite(p.pnlPercent) ? p.pnlPercent : 0,
    }));
  } catch {
    return [];
  }
}

function signedTextClass(n: number): string {
  if (n > 0) return "text-success";
  if (n < 0) return "text-destructive";
  return "text-foreground";
}

function resampleSeries(values: number[], points = 32): number[] {
  if (points <= 0) return [];
  if (values.length === 0) return Array.from({ length: points }, () => 0);
  if (values.length === 1) return Array.from({ length: points }, () => values[0]!);
  if (values.length >= points) return values.slice(values.length - points);

  // Upsample by linear interpolation between real samples (smoother chart, still grounded in data).
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const scaled = t * (values.length - 1);
    const i0 = Math.floor(scaled);
    const i1 = Math.min(values.length - 1, i0 + 1);
    const frac = scaled - i0;
    const v0 = values[Math.max(0, Math.min(values.length - 1, i0))]!;
    const v1 = values[Math.max(0, Math.min(values.length - 1, i1))]!;
    out.push(v0 + (v1 - v0) * frac);
  }
  return out;
}

function TrendSparkline({
  values,
  mode,
  domainMin,
  domainMax,
  height = 132,
}: {
  values: number[];
  mode: ChartMode;
  domainMin: number;
  domainMax: number;
  height?: number;
}) {
  const width = 520;
  const pad = 12;
  const min = domainMin;
  const max = domainMax;
  const span = Math.max(1e-6, max - min);
  const grid = "hsl(240 4% 10%)";
  const up = "hsl(var(--success))";
  const down = "hsl(var(--destructive))";

  const pts = values.map((v, i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(1, values.length - 1);
    const y = pad + ((max - v) * (height - pad * 2)) / span;
    return { x, y, v };
  });

  const topY = pad;
  const bottomY = height - pad;
  const midY = pad + (height - pad * 2) / 2;
  const zeroY = mode === "pnl" ? pad + ((max - 0) * (height - pad * 2)) / span : null;

  const segments: { d: string; color: string }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;

    if (mode === "account") {
      segments.push({
        d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
        color: b.v >= a.v ? up : down,
      });
      continue;
    }

    // PnL: color based on sign relative to 0; split segments on zero-crossing.
    const aPos = a.v >= 0;
    const bPos = b.v >= 0;
    if (aPos === bPos) {
      segments.push({
        d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
        color: aPos ? up : down,
      });
      continue;
    }

    // Zero crossing between a and b (linear interpolate on value).
    const denom = a.v - b.v;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : a.v / denom;
    const cx = a.x + (b.x - a.x) * t;
    const cy = zeroY ?? a.y + (b.y - a.y) * t;
    segments.push({
      d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${cx.toFixed(2)} ${cy.toFixed(2)}`,
      color: aPos ? up : down,
    });
    segments.push({
      d: `M ${cx.toFixed(2)} ${cy.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
      color: bPos ? up : down,
    });
  }

  const last = pts[pts.length - 1];
  const lastColor =
    mode === "pnl" ? ((last?.v ?? 0) >= 0 ? up : down) : (segments[segments.length - 1]?.color ?? up);

  return (
  <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[132px]">
      <line x1={pad} x2={width - pad} y1={topY} y2={topY} stroke={grid} strokeWidth="1" />
      <line x1={pad} x2={width - pad} y1={midY} y2={midY} stroke={grid} strokeWidth="1" opacity="0.55" />
      <line x1={pad} x2={width - pad} y1={bottomY} y2={bottomY} stroke={grid} strokeWidth="1" />
      {mode === "pnl" && zeroY !== null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="hsl(240 4% 16%)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.9"
        />
      )}
      {segments.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={s.color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.96"
        />
      ))}
      {last && (
        <circle
          cx={last.x}
          cy={last.y}
          r="2.2"
          fill={lastColor}
          opacity="0.95"
        />
      )}
    </svg>
  );
}

function TrendChart({ values, mode }: { values: number[]; mode: ChartMode }) {
  const safe = values.length ? values : [0];
  const includeZero = mode === "pnl";
  let min = Math.min(...safe);
  let max = Math.max(...safe);
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }

  let span = max - min;
  if (span < 1e-9) span = Math.max(1, Math.abs(max) * 0.05);
  const padVal = span * 0.12;
  const domainMin = min - padVal;
  const domainMax = max + padVal;
  const domainSpan = Math.max(1e-6, domainMax - domainMin);

  const ticks = [
    domainMax,
    domainMax - domainSpan / 3,
    domainMax - (domainSpan * 2) / 3,
    domainMin,
  ];

  return (
    <div className="mt-4 grid grid-cols-[76px_1fr] gap-4 items-stretch">
      <div className="flex flex-col justify-between pb-1 pt-1 text-[10px] text-muted-foreground select-none font-mono tabular-nums">
        {ticks.map((t, i) => (
          <span key={i} className="truncate">
            {formatUsdCompact(t)}
          </span>
        ))}
      </div>
      <div className="relative">
        <TrendSparkline values={values} mode={mode} domainMin={domainMin} domainMax={domainMax} />
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] text-foreground font-mono">{value}</span>
    </div>
  );
}

const Portfolio = () => {
  const [tab, setTab] = useState<TabKey>("balances");
  const [chartMode, setChartMode] = useState<ChartMode>("account");
  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const [orders, setOrders] = useState<PortfolioOrder[]>(() => loadOrders(address));
  const [trades, setTrades] = useState<PortfolioTradeEvent[]>(() => loadTrades(address));
  const [equityPoints, setEquityPoints] = useState<PortfolioEquityPoint[]>(() => loadEquity(address));
  const [positions, setPositions] = useState<PositionRow[]>(() => loadCachedPositions(address));
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const { usdcxBalance, vaultBalance, creditsBalance } = useUsdcxBalance();
  const { prices, getPrice } = usePrices();

  const walletUsdcx = n2(usdcxBalance);
  const lockedVault = n2(vaultBalance);
  const credits = n2(creditsBalance);

  const executedOpens = useMemo(() => trades.filter((t) => t.type === "OPEN"), [trades]);
  const totalVolume = useMemo(() => {
    const v = executedOpens.reduce((acc, t) => acc + Math.abs(t.collateralUsdcx * t.leverage), 0);
    if (v > 0) return v;
    // Fallback: show current exposure when no history is available in this browser.
    return positions.reduce((acc, p) => acc + Math.abs(p.sizeUsd), 0);
  }, [executedOpens, positions]);

  const realizedPnl = useMemo(() => {
    return trades
      .filter((t) => t.type === "CLOSE")
      .reduce((acc, t) => acc + (t.pnlUsd ?? 0), 0);
  }, [trades]);

  const unrealizedPnl = useMemo(() => positions.reduce((acc, p) => acc + p.pnlUsd, 0), [positions]);

  const positionsCollateral = useMemo(
    () => positions.reduce((acc, p) => acc + p.collateralUsd, 0),
    [positions],
  );

  const totalEquity = useMemo(
    () => walletUsdcx + lockedVault + positionsCollateral + unrealizedPnl,
    [walletUsdcx, lockedVault, positionsCollateral, unrealizedPnl],
  );

  const maxDrawdownPct = useMemo(() => {
    const samples = equityPoints.slice(0, 180).reverse();
    const values =
      samples.length > 1 ? samples.map((p) => p.equityUsd) : [totalEquity];
    const series = resampleSeries(values, 48);
    let peak = series[0] ?? totalEquity;
    let maxDd = 0;
    for (const v of series) {
      peak = Math.max(peak, v);
      if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak);
    }
    return maxDd * 100;
  }, [equityPoints, totalEquity]);

  const chartSeries = useMemo(() => {
    const samples = equityPoints.slice(0, 240).reverse();
    const pnlTotal = realizedPnl + unrealizedPnl;
    const currentValue = chartMode === "pnl" ? pnlTotal : totalEquity;

    const baseValues =
      samples.length <= 1
        ? [currentValue]
        : chartMode === "pnl"
          ? samples.map((p) => p.pnlUsd)
          : samples.map((p) => p.equityUsd);

    const last = baseValues[baseValues.length - 1];
    const values =
      typeof last === "number" && Math.abs(last - currentValue) <= 0.01
        ? baseValues
        : [...baseValues, currentValue];

    return resampleSeries(values, 48);
  }, [chartMode, equityPoints, realizedPnl, unrealizedPnl, totalEquity]);

  const fetchPositions = useCallback(async () => {
    if (!connected) {
      setPositions([]);
      setPositionsError(null);
      return;
    }
    setLoadingPositions(true);
    setPositionsError(null);
    try {
      const fetchWithTimeout = (includePrivate: boolean, timeoutMs: number) =>
        Promise.race<unknown[]>([
          requestProgramRecordsAny(
            requestRecords,
            POSITION_RECORD_PROGRAM_CANDIDATES,
            includePrivate,
            disconnect,
            connect,
          ),
          new Promise<unknown[]>((_, reject) => {
            window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
          }),
        ]);

      const mapRows = (allRecords: unknown[]): PositionRow[] => {
        const parsed = allRecords
          .map((r) => parseAleoPositionRecord(r, MARKET_NAMES))
          .filter((p): p is NonNullable<ReturnType<typeof parseAleoPositionRecord>> => p !== null);

        return parsed.map((p) => {
          const live = getPrice(p.market)?.price ?? p.entryPrice;
          const size = p.size;
          const pnl =
            p.direction === "long"
              ? size * ((live - p.entryPrice) / Math.max(1e-9, p.entryPrice))
              : size * ((p.entryPrice - live) / Math.max(1e-9, p.entryPrice));
          const roe = p.collateral > 0 ? (pnl / p.collateral) * 100 : 0;
          return {
            id: p.id,
            market: p.market,
            direction: p.direction,
            collateralUsd: p.collateral,
            leverage: p.leverage,
            sizeUsd: size,
            entry: p.entryPrice,
            mark: live,
            pnlUsd: pnl,
            roePct: roe,
          };
        });
      };

      let all: unknown[] = [];
      try {
        // Fast path: avoid private decrypt flow unless we need it.
        all = await fetchWithTimeout(false, 5000);
      } catch {
        all = [];
      }

      let rows = Array.isArray(all) ? mapRows(all) : [];

      // If fast-path returned records but no parseable positions, retry with private records.
      if (rows.length === 0) {
        const allPrivate = await fetchWithTimeout(true, 12000);
        rows = Array.isArray(allPrivate) ? mapRows(allPrivate) : [];
      }

      if (rows.length === 0) {
        const snapshotRows = loadTradePositionsSnapshot(address);
        if (snapshotRows.length > 0) rows = snapshotRows;
      }

      setPositions(rows);
      saveCachedPositions(rows, address);
    } catch {
      // Keep previously shown (cached) rows for better UX on slow wallet responses.
      setPositionsError("Could not load positions right now.");
    } finally {
      setLoadingPositions(false);
    }
  }, [connected, requestRecords, getPrice, address, disconnect, connect]);

  useEffect(() => {
    const onOrders = () => setOrders(loadOrders(address));
    const onTrades = () => setTrades(loadTrades(address));
    const onEquity = () => setEquityPoints(loadEquity(address));
    window.addEventListener("autoperp:orders-changed", onOrders);
    window.addEventListener("autoperp:trades-changed", onTrades);
    window.addEventListener("autoperp:equity-changed", onEquity);
    return () => {
      window.removeEventListener("autoperp:orders-changed", onOrders);
      window.removeEventListener("autoperp:trades-changed", onTrades);
      window.removeEventListener("autoperp:equity-changed", onEquity);
    };
  }, [address]);

  useEffect(() => {
    setOrders(loadOrders(address));
    setTrades(loadTrades(address));
    setEquityPoints(loadEquity(address));
    setPositions(loadCachedPositions(address));
  }, [address]);

  useEffect(() => {
    const onSnapshot = () => {
      const snapshotRows = loadTradePositionsSnapshot(address);
      if (snapshotRows.length > 0) {
        setPositions(snapshotRows);
        saveCachedPositions(snapshotRows, address);
      }
    };
    window.addEventListener("autoperp:positions-snapshot-changed", onSnapshot);
    return () => window.removeEventListener("autoperp:positions-snapshot-changed", onSnapshot);
  }, [address]);

  useEffect(() => {
    fetchPositions();
    const onPositionsChanged = () => fetchPositions();
    const interval = window.setInterval(fetchPositions, 30000);
    window.addEventListener("autoperp:positions-changed", onPositionsChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("autoperp:positions-changed", onPositionsChanged);
    };
  }, [fetchPositions]);

  // Keep mark + unrealized PnL live as the price feed updates (without waiting for record re-sync).
  useEffect(() => {
    if (positions.length === 0) return;
    setPositions((prev) =>
      prev.map((p) => {
        const live = prices.find((x) => x.symbol === p.market)?.price ?? 0;
        if (!live || live <= 0) return p;
        const size = p.sizeUsd;
        const pnl =
          p.direction === "long"
            ? size * ((live - p.entry) / Math.max(1e-9, p.entry))
            : size * ((p.entry - live) / Math.max(1e-9, p.entry));
        const roe = p.collateralUsd > 0 ? (pnl / p.collateralUsd) * 100 : 0;
        return { ...p, mark: live, pnlUsd: pnl, roePct: roe };
      }),
    );
  }, [prices, positions.length]);

  useEffect(() => {
    if (!connected) return;

    const pnlTotal = realizedPnl + unrealizedPnl;
    const ts = Date.now();
    const point: PortfolioEquityPoint = {
      ts,
      equityUsd: totalEquity,
      pnlUsd: pnlTotal,
      walletUsdcx,
      vaultUsdcx: lockedVault,
      positionsCollateralUsdcx: positionsCollateral,
      unrealizedPnlUsd: unrealizedPnl,
    };

    const last = loadEquity(address)[0];
    const minIntervalMs = 20_000;
    const eqDelta = Math.abs((last?.equityUsd ?? point.equityUsd) - point.equityUsd);
    const pnlDelta = Math.abs((last?.pnlUsd ?? point.pnlUsd) - point.pnlUsd);
    const unrealDelta = Math.abs((last?.unrealizedPnlUsd ?? point.unrealizedPnlUsd) - point.unrealizedPnlUsd);
    const recentlySampled = !!last && ts - last.ts < minIntervalMs;

    if (recentlySampled && eqDelta < 0.01 && pnlDelta < 0.01 && unrealDelta < 0.01) return;
    addEquityPoint(point, address);
  }, [
    address,
    connected,
    lockedVault,
    positionsCollateral,
    realizedPnl,
    totalEquity,
    unrealizedPnl,
    walletUsdcx,
  ]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "balances", label: "Balances" },
    { key: "positions", label: "Positions" },
    { key: "open_orders", label: "Open Orders" },
    { key: "trade_history", label: "Trade History" },
    { key: "funding_history", label: "Funding History" },
    { key: "order_history", label: "Order History" },
  ];

  return (
    <WalletGate pageName="Portfolio">
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-16 pb-12">
          <div className="container max-w-6xl">
            <h1 className="text-2xl md:text-[30px] font-bold tracking-tight text-foreground">
              Portfolio
            </h1>

            <div className="mt-4 border-t border-border/70" />

            <div className="mt-8">
              <div className="grid grid-cols-1 md:grid-cols-[320px_320px_1fr] gap-0">
                {/* Left */}
                <div className="pr-0 md:pr-12 pb-10 md:pb-0">
                  <div className="space-y-7">
                    <div>
                      <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
                        Total Volume
                      </p>
                      <p className="mt-2 text-[34px] leading-none font-mono text-foreground">
                        {formatUsd(totalVolume)}
                      </p>
                    </div>

                    <div className="border-t border-border/70 pt-6">
                      <p className="text-[10px] tracking-wider uppercase text-muted-foreground">
                        Fees (Taker / Maker)
                      </p>
                      <p className="mt-2 text-[26px] leading-none font-mono text-foreground">
                        {TAKER_FEE_PCT.toFixed(4)}% / {MAKER_FEE_PCT.toFixed(4)}%
                      </p>
                    </div>
                  </div>
                </div>

                {/* Middle */}
                <div className="md:border-l md:border-border/70 md:px-12 pb-10 md:pb-0">
                  <div className="space-y-1 pt-0.5 max-w-[280px]">
                    <div className="flex items-center justify-between gap-6 py-1.5">
                      <span className="text-[11px] text-muted-foreground">PNL</span>
                      <span
                        className={cn(
                          "text-[11px] font-mono",
                          signedTextClass(realizedPnl + unrealizedPnl),
                        )}
                      >
                        {formatUsd(realizedPnl + unrealizedPnl)}
                      </span>
                    </div>
                    <MetricRow label="Volume" value={formatUsd(totalVolume)} />
                    <MetricRow label="Max Drawdown" value={formatPct(maxDrawdownPct)} />
                    <MetricRow label="Total Equity" value={formatUsd(totalEquity)} />
                    <MetricRow label="Aleo Credits" value={`${formatNum(credits)} Aleo`} />
                    <MetricRow label="Wallet USDCx" value={formatNum(walletUsdcx)} />
                    <MetricRow label="Locked Vault" value={formatNum(lockedVault)} />
                  </div>
                </div>

                {/* Right */}
                <div className="md:border-l md:border-border/70 md:pl-12">
                  <div className="flex items-end justify-between">
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setChartMode("account")}
                        className={cn(
                          "text-[11px] font-semibold tracking-wide uppercase pb-1 border-b-2 transition-colors",
                          chartMode === "account"
                            ? "text-foreground border-primary"
                            : "text-muted-foreground border-transparent hover:text-foreground",
                        )}
                      >
                        Account Value
                      </button>
                      <button
                        onClick={() => setChartMode("pnl")}
                        className={cn(
                          "text-[11px] font-semibold tracking-wide uppercase pb-1 border-b-2 transition-colors",
                          chartMode === "pnl"
                            ? "text-foreground border-primary"
                            : "text-muted-foreground border-transparent hover:text-foreground",
                        )}
                      >
                        PNL
                      </button>
                    </div>
                  </div>

                  <TrendChart values={chartSeries} mode={chartMode} />
                </div>
              </div>
            </div>

            <div className="mt-14">
              <div className="flex items-center justify-between border-b border-border/70">
                <div className="flex flex-wrap items-center gap-6">
                  {tabs.map((t) => {
                    const active = tab === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={cn(
                          "text-sm transition-colors pb-3 border-b-2 -mb-px",
                          active
                            ? "text-foreground border-foreground"
                            : "text-muted-foreground border-transparent hover:text-foreground",
                        )}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                <button className="text-[10px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors">
                  ALL <span className="ml-1">▼</span>
                </button>
              </div>

              <div
                className={cn(
                  "mt-4 border border-border/70 bg-background rounded-xl overflow-hidden",
                  tab === "balances" ? "w-full md:w-[560px]" : "w-full",
                )}
              >
                {tab === "balances" && (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border/70 bg-card/20">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Coins</th>
                        <th className="px-4 py-3 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      <tr>
                        <td className="px-4 py-3 text-foreground">USDCx</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">
                          {formatNum(walletUsdcx)}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-3 text-foreground">Aleo</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">
                          {formatNum(credits)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {tab === "positions" && (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border/70 bg-card/20">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Coin</th>
                        <th className="px-4 py-3 text-right font-medium">Size</th>
                        <th className="px-4 py-3 text-right font-medium">Entry Price</th>
                        <th className="px-4 py-3 text-right font-medium">Mark Price</th>
                        <th className="px-4 py-3 text-right font-medium">
                          <span className="text-primary/70 underline underline-offset-4">PNL (ROE %)</span>
                        </th>
                        <th className="px-4 py-3 text-right font-medium">Liq. Price</th>
                        <th className="px-4 py-3 text-right font-medium">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {loadingPositions && positions.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                            Loading positions from chain...
                          </td>
                        </tr>
                      )}
                      {!loadingPositions && positionsError && (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-destructive">
                            {positionsError}
                          </td>
                        </tr>
                      )}
                      {!loadingPositions && !positionsError && positions.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                            No open positions.
                          </td>
                        </tr>
                      )}
                      {!loadingPositions &&
                        positions.map((p) => (
                          <tr key={p.id}>
                            <td className="px-4 py-3 text-foreground">
                              <div className="flex items-center gap-2">
                                <span className="text-foreground">{p.market}</span>
                                <span
                                  className={cn(
                                    "text-[10px] uppercase px-1.5 py-0.5 rounded border border-border/60",
                                    p.direction === "long" ? "text-success" : "text-destructive",
                                  )}
                                >
                                  {p.direction}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {formatUsd(p.sizeUsd)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {formatUsd(p.entry)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {formatUsd(p.mark)}
                            </td>
                            <td
                              className={cn(
                                "px-4 py-3 text-right font-mono",
                                p.pnlUsd >= 0 ? "text-success" : "text-destructive",
                              )}
                            >
                              {p.pnlUsd >= 0 ? "+" : "-"}
                              {formatUsd(Math.abs(p.pnlUsd))} ({p.roePct >= 0 ? "+" : "-"}
                              {formatPct(Math.abs(p.roePct))})
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">--</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">--</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}

                {tab === "open_orders" && (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border/70 bg-card/20">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Market</th>
                        <th className="px-4 py-3 text-left font-medium">Side</th>
                        <th className="px-4 py-3 text-left font-medium">Type</th>
                        <th className="px-4 py-3 text-right font-medium">Collateral</th>
                        <th className="px-4 py-3 text-right font-medium">Lev</th>
                        <th className="px-4 py-3 text-right font-medium">Limit</th>
                        <th className="px-4 py-3 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {orders.filter((o) => o.status === "open").length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                            No open orders.
                          </td>
                        </tr>
                      )}
                      {orders
                        .filter((o) => o.status === "open")
                        .map((o) => (
                          <tr key={o.id}>
                            <td className="px-4 py-3 text-foreground">{o.market}</td>
                            <td className="px-4 py-3 text-foreground uppercase">{o.side}</td>
                            <td className="px-4 py-3 text-foreground uppercase">{o.kind}</td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {formatNum(o.collateralUsdcx)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">{o.leverage}x</td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {o.kind === "limit" && o.limitPrice ? formatUsd(o.limitPrice) : "--"}
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{o.status}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}

                {tab === "trade_history" && (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border/70 bg-card/20">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Type</th>
                        <th className="px-4 py-3 text-left font-medium">Market</th>
                        <th className="px-4 py-3 text-left font-medium">Side</th>
                        <th className="px-4 py-3 text-right font-medium">Collateral</th>
                        <th className="px-4 py-3 text-right font-medium">Lev</th>
                        <th className="px-4 py-3 text-right font-medium">Entry</th>
                        <th className="px-4 py-3 text-right font-medium">Exit</th>
                        <th className="px-4 py-3 text-right font-medium">PNL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {trades.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                            No trade history yet.
                          </td>
                        </tr>
                      )}
                      {trades.map((t) => (
                        <tr key={t.id}>
                          <td className="px-4 py-3 text-foreground">{t.type}</td>
                          <td className="px-4 py-3 text-foreground">{t.market}</td>
                          <td className="px-4 py-3 text-foreground uppercase">{t.side}</td>
                          <td className="px-4 py-3 text-right font-mono text-foreground">
                            {formatNum(t.collateralUsdcx)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-foreground">{t.leverage}x</td>
                          <td className="px-4 py-3 text-right font-mono text-foreground">{formatUsd(t.entryPrice)}</td>
                          <td className="px-4 py-3 text-right font-mono text-foreground">
                            {typeof t.exitPrice === "number" ? formatUsd(t.exitPrice) : "--"}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 text-right font-mono",
                              (t.pnlUsd ?? 0) >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {typeof t.pnlUsd === "number" ? formatUsd(t.pnlUsd) : "--"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === "funding_history" && (
                  <div className="px-4 py-10 text-center text-muted-foreground text-sm">
                    Funding history is not available yet.
                  </div>
                )}

                {tab === "order_history" && (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border/70 bg-card/20">
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-medium">Market</th>
                        <th className="px-4 py-3 text-left font-medium">Side</th>
                        <th className="px-4 py-3 text-left font-medium">Type</th>
                        <th className="px-4 py-3 text-right font-medium">Collateral</th>
                        <th className="px-4 py-3 text-right font-medium">Lev</th>
                        <th className="px-4 py-3 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {orders.filter((o) => o.status !== "open").length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                            No order history yet.
                          </td>
                        </tr>
                      )}
                      {orders
                        .filter((o) => o.status !== "open")
                        .map((o) => (
                          <tr key={o.id}>
                            <td className="px-4 py-3 text-foreground">{o.market}</td>
                            <td className="px-4 py-3 text-foreground uppercase">{o.side}</td>
                            <td className="px-4 py-3 text-foreground uppercase">{o.kind}</td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">
                              {formatNum(o.collateralUsdcx)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-foreground">{o.leverage}x</td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{o.status}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </WalletGate>
  );
};

export default Portfolio;
