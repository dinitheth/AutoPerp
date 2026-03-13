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
