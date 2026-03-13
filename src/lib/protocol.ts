export const PROGRAMS = {
  CORE: "autoperp_core_private_v2.aleo",
  POOL: "autoperp_pool_v2.aleo",
  AGENT: "autoperp_agent_v2.aleo",
  ORACLE: "autoperp_oracle.aleo",
  USDCX: "test_usdcx_stablecoin.aleo",
} as const;

export const PRIVATE_CORE_PROGRAM = "autoperp_core_private_v2.aleo";
export const PUBLIC_CORE_PROGRAM = "autoperp_core_v5.aleo";

export type TradingMode = "private" | "public";
export const TRADING_MODE_STORAGE_KEY = "autoperp:trading:mode";

export function resolveCoreProgram(mode: TradingMode): string {
  return mode === "private" ? PRIVATE_CORE_PROGRAM : PUBLIC_CORE_PROGRAM;
}

export function getStoredTradingMode(): TradingMode {
  const raw = localStorage.getItem(TRADING_MODE_STORAGE_KEY);
  if (raw === "private" || raw === "public") return raw;
  return "public";
}

export function setStoredTradingMode(mode: TradingMode) {
  localStorage.setItem(TRADING_MODE_STORAGE_KEY, mode);
}

export const STRICT_PRIVATE_CORE_ACTIVE =
  PROGRAMS.CORE === PRIVATE_CORE_PROGRAM;

export const PROGRAM_ADDRESSES = {
  CORE: "at1jq0n5a3pf9rnyranqdsqmexzxh3rllenq4sdch5wcmexspjtyq9sdvn7f3",
  POOL: "",
} as const;

export const REAL_SETTLEMENT_AVAILABLE = true;

export const LEGACY_SETTLEMENT_MESSAGE =
  "Legacy AutoPerp deployments only updated internal bookkeeping. Redeploy autoperp_core_v5.aleo before allowing live USDCx-backed deposits, liquidity, or trading.";
