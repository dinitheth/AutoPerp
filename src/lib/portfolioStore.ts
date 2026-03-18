export type OrderSide = "long" | "short";
export type OrderKind = "market" | "limit";
export type OrderStatus = "open" | "cancelled" | "executed";

export interface PortfolioOrder {
  id: string;
  market: string;
  side: OrderSide;
  kind: OrderKind;
  collateralUsdcx: number;
  leverage: number;
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  createdAt: number;
  status: OrderStatus;
  executedTxId?: string;
}

export type TradeEventType = "OPEN" | "CLOSE";

export interface PortfolioTradeEvent {
  id: string;
  type: TradeEventType;
  market: string;
  side: OrderSide;
  collateralUsdcx: number;
  leverage: number;
  entryPrice: number;
  exitPrice?: number;
  pnlUsd?: number;
  txId: string;
  ts: number;
}

const ORDERS_KEY = "autoperp:portfolio:orders";
const TRADES_KEY = "autoperp:portfolio:trades";
const EQUITY_KEY = "autoperp:portfolio:equity";

function normalizeScope(scope?: string | null): string {
  const s = (scope ?? "").trim().toLowerCase();
  return s || "guest";
}

function key(base: string, scope?: string | null): string {
  return `${base}:${normalizeScope(scope)}`;
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadOrders(scope?: string | null): PortfolioOrder[] {
  return safeParseJson<PortfolioOrder[]>(localStorage.getItem(key(ORDERS_KEY, scope)), []);
}

export function saveOrders(orders: PortfolioOrder[], scope?: string | null) {
  localStorage.setItem(key(ORDERS_KEY, scope), JSON.stringify(orders));
  window.dispatchEvent(new Event("autoperp:orders-changed"));
}

export function addOrder(order: PortfolioOrder, scope?: string | null) {
  const existing = loadOrders(scope);
  saveOrders([order, ...existing], scope);
}

export function updateOrder(id: string, patch: Partial<PortfolioOrder>, scope?: string | null) {
  const existing = loadOrders(scope);
  const next = existing.map((o) => (o.id === id ? { ...o, ...patch } : o));
  saveOrders(next, scope);
}

export function loadTrades(scope?: string | null): PortfolioTradeEvent[] {
  return safeParseJson<PortfolioTradeEvent[]>(localStorage.getItem(key(TRADES_KEY, scope)), []);
}

export function saveTrades(trades: PortfolioTradeEvent[], scope?: string | null) {
  localStorage.setItem(key(TRADES_KEY, scope), JSON.stringify(trades));
  window.dispatchEvent(new Event("autoperp:trades-changed"));
}

export function addTradeEvent(ev: PortfolioTradeEvent, scope?: string | null) {
  const existing = loadTrades(scope);
  saveTrades([ev, ...existing], scope);
}

// ---------------------------------------------------------------------------
// Privacy-safe persistence via Supabase Edge Function → Neon Postgres
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let _supabase: typeof import("@/integrations/supabase/client").supabase | null = null;

async function getSupabase() {
  if (_supabase) return _supabase;
  const { supabase } = await import("@/integrations/supabase/client");
  _supabase = supabase;
  return supabase;
}

/**
 * Write trade event to localStorage (instant) AND persist to Neon via edge
 * function. The wallet address is SHA-256 hashed before being sent to the DB
 * so the database never stores the real Aleo address.
 */
export async function addTradeEventPersistent(
  ev: PortfolioTradeEvent,
  scope?: string | null,
) {
  // 1. Always write to localStorage first
  addTradeEvent(ev, scope);

  // 2. Persist to Neon via user's Supabase Edge Function API
  try {
    const wallet = (scope ?? "").trim().toLowerCase();
    if (!wallet) return;
    const walletHash = await sha256Hex(wallet);
    const sb = await getSupabase();
    
    const action = ev.type === "OPEN" ? "open" : "close";
    const body = ev.type === "OPEN" 
      ? {
          wallet_address: walletHash,
          market: ev.market,
          direction: ev.side,
          collateral: ev.collateralUsdcx,
          leverage: ev.leverage,
          entry_price: ev.entryPrice,
          tx_hash: "", // Privacy: Hide TX Hash to prevent blockchain correlation
        }
      : {
          id: ev.id,
          exit_price: ev.exitPrice,
          pnl: ev.pnlUsd,
          tx_hash: "", // Privacy: Hide TX Hash to prevent blockchain correlation
        };

    const { error } = await sb.functions.invoke(`trade-history?action=${action}`, {
      body,
    });
    if (error) console.warn("[portfolioStore] Remote save failed:", error);
  } catch (err) {
    console.warn("[portfolioStore] Remote save error:", err);
  }
}

/**
 * Load trade history from Neon (via edge function), merge with localStorage,
 * and return the unified list. Falls back to localStorage on any error.
 */
export async function loadTradesRemote(
  scope?: string | null,
): Promise<PortfolioTradeEvent[]> {
  const local = loadTrades(scope);
  try {
    const wallet = (scope ?? "").trim().toLowerCase();
    if (!wallet) return local;
    const walletHash = await sha256Hex(wallet);
    const sb = await getSupabase();
    const { data, error } = await sb.functions.invoke(`trade-history?wallet=${walletHash}&limit=500`, {
      method: "GET",
    });

    if (error) return local;
    
    // Note: The user's Edge Function might return the array directly or wrapping it.
    // We assume data is an array of trades based on typical Supabase GET requests.
    const tradesList = Array.isArray(data) ? data : data?.trades;
    if (!Array.isArray(tradesList)) return local;

    const remoteTrades: PortfolioTradeEvent[] = tradesList.map((row: any) => ({
      id: String(row.id),
      type: String(row.event_type || (row.status === "closed" ? "CLOSE" : "OPEN")) as TradeEventType,
      market: String(row.market),
      side: String(row.direction || row.side) as OrderSide,
      collateralUsdcx: Number(row.collateral || row.collateral_usdcx || 0),
      leverage: Number(row.leverage || 0),
      entryPrice: Number(row.entry_price || 0),
      exitPrice: row.exit_price ? Number(row.exit_price) : undefined,
      pnlUsd: row.pnl ? Number(row.pnl) : (row.pnl_usd ? Number(row.pnl_usd) : undefined),
      txId: String(row.tx_hash || row.tx_id),
      ts: row.created_at ? new Date(String(row.created_at)).getTime() : Date.now(),
    }));

    // Deduplicate by id, preferring remote (more authoritative)
    const byId = new Map<string, PortfolioTradeEvent>();
    for (const t of local) byId.set(t.id, t);
    for (const t of remoteTrades) byId.set(t.id, t);
    const merged = Array.from(byId.values()).sort((a, b) => b.ts - a.ts);

    // Sync merged result back to localStorage
    saveTrades(merged, scope);
    return merged;
  } catch {
    return local;
  }
}

export interface PortfolioEquityPoint {
  ts: number;
  equityUsd: number;
  pnlUsd: number;
  walletUsdcx: number;
  vaultUsdcx: number;
  positionsCollateralUsdcx: number;
  unrealizedPnlUsd: number;
}

export function loadEquity(scope?: string | null): PortfolioEquityPoint[] {
  return safeParseJson<PortfolioEquityPoint[]>(localStorage.getItem(key(EQUITY_KEY, scope)), []);
}

export function saveEquity(points: PortfolioEquityPoint[], scope?: string | null) {
  localStorage.setItem(key(EQUITY_KEY, scope), JSON.stringify(points));
  window.dispatchEvent(new Event("autoperp:equity-changed"));
}

export function addEquityPoint(point: PortfolioEquityPoint, scope?: string | null) {
  const existing = loadEquity(scope);
  const next = [point, ...existing].slice(0, 720); // keep ~12h at 1/min, or ~1 week at 15min
  saveEquity(next, scope);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
