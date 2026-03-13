export const PROGRAMS = {
  CORE: import.meta.env.VITE_AUTOPERP_CORE_PROGRAM ?? "autoperp_core_private_v1.aleo",
  POOL: import.meta.env.VITE_AUTOPERP_POOL_PROGRAM ?? "autoperp_pool_v2.aleo",
  AGENT: import.meta.env.VITE_AUTOPERP_AGENT_PROGRAM ?? "autoperp_agent_v2.aleo",
  ORACLE: import.meta.env.VITE_AUTOPERP_ORACLE_PROGRAM ?? "autoperp_oracle.aleo",
  USDCX: "test_usdcx_stablecoin.aleo",
} as const;

export const PRIVATE_CORE_PROGRAM = "autoperp_core_private_v1.aleo";

export const STRICT_PRIVATE_CORE_ACTIVE =
  PROGRAMS.CORE === PRIVATE_CORE_PROGRAM;

export const PROGRAM_ADDRESSES = {
  CORE: "at1jq0n5a3pf9rnyranqdsqmexzxh3rllenq4sdch5wcmexspjtyq9sdvn7f3",
  POOL: import.meta.env.VITE_AUTOPERP_POOL_ADDRESS ?? "",
} as const;

export const REAL_SETTLEMENT_AVAILABLE =
  import.meta.env.VITE_AUTOPERP_REAL_SETTLEMENT !== "false";

export const LEGACY_SETTLEMENT_MESSAGE =
  "Legacy AutoPerp deployments only updated internal bookkeeping. Redeploy autoperp_core_v5.aleo (or set VITE_AUTOPERP_CORE_PROGRAM to your redeployed core program) before allowing live USDCx-backed deposits, liquidity, or trading.";
