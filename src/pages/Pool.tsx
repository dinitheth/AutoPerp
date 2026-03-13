import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Lock, TrendingUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import Header from "@/components/layout/Header";
import WalletGate from "@/components/wallet/WalletGate";
import Footer from "@/components/layout/Footer";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import useUsdcxBalance from "@/hooks/useUsdcxBalance";
import { API_BASE, useAleoTransaction, PROGRAMS, toUsdcx } from "@/hooks/useAleoTransaction";
import {
  LEGACY_SETTLEMENT_MESSAGE,
  REAL_SETTLEMENT_AVAILABLE,
  STRICT_PRIVATE_CORE_ACTIVE,
} from "@/lib/protocol";
import { findPoolStateRecord } from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords } from "@/lib/walletRecords";
import { toast } from "sonner";

const pools = [
  { name: "BTC-USD Pool", poolId: "0u8", marketKey: "BTC-USD" },
  { name: "ETH-USD Pool", poolId: "1u8", marketKey: "ETH-USD" },
  { name: "ALEO-USD Pool", poolId: "2u8", marketKey: "ALEO-USD" },
];

interface UserLpInfo {
  poolId: string;
  shares: number;
}

function parseUnsignedInt(raw: string): number {
  const cleaned = raw.replace(/"/g, "").replace(/u\d+$/i, "").replace(/_/g, "").trim();
  if (!/^\d+$/.test(cleaned)) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseBalanceStruct(raw: string): number {
  const match = raw.match(/balance:\s*([\d_]+)u(?:64|128)/i);
  if (!match) return 0;
  return parseUnsignedInt(match[1]);
}

function parseMappingBalance(raw: string): number {
  const structBalance = parseBalanceStruct(raw);
  if (structBalance > 0) return structBalance;
  return parseUnsignedInt(raw);
}

function estimateClaimableFees(
  userShares: number,
  totalPoolShares: number,
  totalPoolFeesUsdcx: number,
): number {
  if (!Number.isFinite(userShares) || userShares <= 0) return 0;
  if (!Number.isFinite(totalPoolShares) || totalPoolShares <= 0) return 0;
  if (!Number.isFinite(totalPoolFeesUsdcx) || totalPoolFeesUsdcx <= 0) return 0;
  return (userShares * totalPoolFeesUsdcx) / totalPoolShares;
}

const Pool = () => {
  const [amount, setAmount] = useState("");
  const [selectedPool, setSelectedPool] = useState(0);
  const [poolBalances, setPoolBalances] = useState<Record<string, number>>({});
  const [poolFees, setPoolFees] = useState<Record<string, number>>({});
  const [poolShares, setPoolShares] = useState<Record<string, number>>({});
  const [userLpByPool, setUserLpByPool] = useState<Record<string, number>>({});
  const [loadingPoolBalances, setLoadingPoolBalances] = useState(false);

  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { usdcxBalance, refetch: refetchBalance } = useUsdcxBalance();
  const { execute, loading: txLoading } = useAleoTransaction();

  const refreshPoolBalances = useCallback(async () => {
    if (!REAL_SETTLEMENT_AVAILABLE) return;
    setLoadingPoolBalances(true);
    try {
      const entries = await Promise.all(
        pools.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/program/${PROGRAMS.CORE}/mapping/pool_balance/${p.poolId}`);
            if (!res.ok) return [p.poolId, 0] as const;
            const txt = await res.text();
            const micro = parseMappingBalance(txt);
            return [p.poolId, micro / 1_000_000] as const;
          } catch {
            return [p.poolId, 0] as const;
          }
        }),
      );
      const feeEntries = await Promise.all(
        pools.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/program/${PROGRAMS.CORE}/mapping/pool_fees/${p.poolId}`);
            if (!res.ok) return [p.poolId, 0] as const;
            const txt = await res.text();
            const micro = parseMappingBalance(txt);
            return [p.poolId, micro / 1_000_000] as const;
          } catch {
            return [p.poolId, 0] as const;
          }
        }),
      );
      const shareEntries = await Promise.all(
        pools.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/program/${PROGRAMS.CORE}/mapping/pool_shares/${p.poolId}`);
            if (!res.ok) return [p.poolId, 0] as const;
            const txt = await res.text();
            const n = parseMappingBalance(txt);
            return [p.poolId, n] as const;
          } catch {
            return [p.poolId, 0] as const;
          }
        }),
      );
      setPoolBalances(Object.fromEntries(entries));
      setPoolFees(Object.fromEntries(feeEntries));
      setPoolShares(Object.fromEntries(shareEntries));
    } finally {
      setLoadingPoolBalances(false);
    }
  }, []);

  const refreshUserLp = useCallback(async () => {
    if (!connected) {
      setUserLpByPool({});
      return;
    }
    try {
      const records = await requestProgramRecords(
        requestRecords,
        PROGRAMS.CORE,
        true,
        disconnect,
        connect,
      );
      const sums: Record<string, number> = {};
      for (const record of records) {
        const source = record as Record<string, unknown>;
        const plain =
          (typeof source.recordPlaintext === "string" && source.recordPlaintext) ||
          (typeof source.plaintext === "string" && source.plaintext) ||
          (typeof source.record === "string" && source.record) ||
          (typeof source.data === "string" && source.data) ||
          (typeof record === "string" ? record : "");
        if (!plain || !/pool_id\s*:/i.test(plain) || !/shares\s*:/i.test(plain) || !/deposit_amount\s*:/i.test(plain)) {
          continue;
        }
        const poolMatch = plain.match(/pool_id\s*:\s*([^,\n}]+)/i);
        const sharesMatch = plain.match(/shares\s*:\s*([^,\n}]+)/i);
        if (!poolMatch || !sharesMatch) continue;
        const poolId = String(poolMatch[1]).replace(/\.(private|public)$/i, "").trim();
        const sharesRaw = String(sharesMatch[1])
          .replace(/\.(private|public)$/i, "")
          .replace(/u\d+$/i, "")
          .replace(/_/g, "")
          .trim();
        const shares = Number(sharesRaw);
        if (!Number.isFinite(shares) || shares <= 0) continue;
        sums[poolId] = (sums[poolId] ?? 0) + shares;
      }
      setUserLpByPool(sums);
    } catch (error) {
      if (isProgramNotAllowedError(error)) {
        toast.error("Shield blocked private LP record access. Reconnect wallet and approve program permissions.");
      }
      setUserLpByPool({});
    }
  }, [connected, requestRecords, disconnect, connect]);

  useEffect(() => {
    refreshPoolBalances();
    const interval = setInterval(refreshPoolBalances, 20000);
    return () => clearInterval(interval);
  }, [refreshPoolBalances]);

  useEffect(() => {
    refreshUserLp();
    const interval = setInterval(refreshUserLp, 30000);
    return () => clearInterval(interval);
  }, [refreshUserLp]);

  const selectedPoolLiquidity = useMemo(() => {
    const pool = pools[selectedPool];
    const v = poolBalances[pool.poolId];
    return typeof v === "number" ? v : null;
  }, [poolBalances, selectedPool]);

  const totalLiquidity = useMemo(() => {
    return pools.reduce((acc, p) => acc + (poolBalances[p.poolId] ?? 0), 0);
  }, [poolBalances]);

  const totalPoolFees = useMemo(() => {
    return pools.reduce((acc, p) => acc + (poolFees[p.poolId] ?? 0), 0);
  }, [poolFees]);

  const selectedPoolId = pools[selectedPool].poolId;
  const selectedPoolTotalShares = poolShares[selectedPoolId] ?? 0;
  const selectedPoolUserShares = userLpByPool[selectedPoolId] ?? 0;
  const selectedPoolFeeBalance = poolFees[selectedPoolId] ?? 0;
  const selectedPoolSharePct =
    selectedPoolTotalShares > 0 ? (selectedPoolUserShares / selectedPoolTotalShares) * 100 : 0;
  const selectedPoolClaimableFees = estimateClaimableFees(
    selectedPoolUserShares,
    selectedPoolTotalShares,
    selectedPoolFeeBalance,
  );

  const handleMax = () => {
    if (usdcxBalance && parseFloat(usdcxBalance) > 0) {
      setAmount(usdcxBalance);
    }
  };

  const handleDeposit = async () => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      return;
    }

    if (!connected) {
      toast.error("Connect your Shield wallet first.");
      return;
    }

    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) {
      toast.error("Enter a valid deposit amount.");
      return;
    }

    if (usdcxBalance && depositAmount > parseFloat(usdcxBalance)) {
      toast.error("Insufficient USDCx balance.");
      return;
    }

    const pool = pools[selectedPool];
    let result = null;

    if (STRICT_PRIVATE_CORE_ACTIVE) {
      const owner = address ?? "";

      const loadPool = async () => {
        const records = await requestProgramRecords(
          requestRecords,
          PROGRAMS.CORE,
          true,
          disconnect,
          connect,
        );
        return findPoolStateRecord(records, owner, pool.poolId);
      };

      let poolRecord = await loadPool();
      if (!poolRecord) {
        const bootstrapped = await execute(PROGRAMS.CORE, "bootstrap_pool", [pool.poolId, "0u64"]);
        if (!bootstrapped) {
          toast.error("Could not initialize private pool state record.");
          return;
        }
        poolRecord = await loadPool();
      }

      if (!poolRecord) {
        toast.error("Could not load private pool state record.");
        return;
      }

      result = await execute(PROGRAMS.CORE, "deposit_liquidity", [poolRecord.input, toUsdcx(depositAmount)]);
    } else {
      result = await execute(PROGRAMS.CORE, "deposit_liquidity", [pool.poolId, toUsdcx(depositAmount)]);
    }

    if (result) {
      setAmount("");
      toast.success(`Deposited ${depositAmount} USDCx to ${pool.name}`);
      // Shield + explorer API can lag; refresh a couple times so the UI reflects the on-chain balance change.
      setTimeout(() => refetchBalance(), 2500);
      setTimeout(() => refetchBalance(), 8000);
      setTimeout(() => refreshPoolBalances(), 2500);
      setTimeout(() => refreshPoolBalances(), 8000);
    }
  };

  return (
    <WalletGate pageName="Liquidity Pools">
      <div className="min-h-screen bg-background">
        <Header />

        <main className="pt-24 pb-20">
          <div className="container max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
                Liquidity Pools
              </h1>
              <p className="text-sm text-muted-foreground mb-8">
                Provide liquidity to the same settlement contract that backs trader PnL.
                LP ownership records are private while transfer settlement remains publicly visible on explorer.
              </p>

              {!REAL_SETTLEMENT_AVAILABLE && (
                <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  {LEGACY_SETTLEMENT_MESSAGE}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  {
                    icon: Layers,
                    label: "Total Liquidity",
                    value: loadingPoolBalances
                      ? "..."
                      : `${totalLiquidity.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} USDCx`,
                  },
                  {
                    icon: TrendingUp,
                    label: "Accrued Fees",
                    value: loadingPoolBalances
                      ? "..."
                      : `${totalPoolFees.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} USDCx`,
                  },
                  { icon: TrendingUp, label: "Fee Rate", value: "0.06%" },
                  { icon: Lock, label: "Privacy", value: "Mixed" },
                ].map((s) => (
                  <div key={s.label} className="p-4 rounded-xl border border-border bg-card text-center">
                    <s.icon className="h-4 w-4 text-primary mx-auto mb-2" />
                    <p className="text-lg md:text-xl font-bold font-mono text-foreground">{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-3 mb-8">
                {pools.map((pool, i) => (
                  <button
                    key={pool.name}
                    onClick={() => setSelectedPool(i)}
                    className={cn(
                      "w-full p-4 rounded-xl border text-left transition-all",
                      selectedPool === i
                        ? "border-primary bg-card glow-primary"
                        : "border-border bg-card hover:border-border/80",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">{pool.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Liquidity:{" "}
                            <span className="text-foreground">
                              {loadingPoolBalances
                                ? "..."
                                : (poolBalances[pool.poolId] ?? 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                              USDCx
                            </span>
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">Pool ID: {pool.poolId}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="p-6 rounded-xl border border-border bg-card">
                <h3 className="text-sm font-semibold text-foreground mb-4">
                  Add Liquidity to {pools[selectedPool].name}
                </h3>

                {connected && usdcxBalance && (
                  <div className="mb-3 text-[10px] text-muted-foreground">
                    Available: <span className="font-mono text-foreground">{usdcxBalance} USDCx</span>
                  </div>
                )}

                <div className="mb-4">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Amount (USDCx)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full h-10 px-3 text-sm font-mono bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={handleMax}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-primary font-medium"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee Rate</span>
                    <span className="font-mono text-foreground">0.06% per trade</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pool Liquidity</span>
                    <span className="font-mono text-foreground">
                      {selectedPoolLiquidity === null || loadingPoolBalances
                        ? "--"
                        : selectedPoolLiquidity.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                      USDCx
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your Pool Share</span>
                    <span className="font-mono text-foreground">
                      {selectedPoolSharePct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimated Claimable Fees</span>
                    <span className="font-mono text-success">
                      {selectedPoolClaimableFees.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} USDCx
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimation Formula</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      (your shares × pool fees) / total shares
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Settlement</span>
                    <span className="text-success text-[10px]">Shared with trader payouts</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Privacy</span>
                    <span className="text-warning text-[10px]">Private LP records + public transfers</span>
                  </div>
                </div>

                {(() => {
                  const amt = parseFloat(amount);
                  const bal = parseFloat(usdcxBalance ?? "0");
                  const insufficient = amt > 0 && amt > bal;
                  const tooSmall = amt > 0 && amt < 1;
                  const disabled =
                    txLoading ||
                    !REAL_SETTLEMENT_AVAILABLE ||
                    !amount ||
                    !amt ||
                    insufficient ||
                    tooSmall ||
                    !connected;
                  const label = !REAL_SETTLEMENT_AVAILABLE
                    ? "Redeploy Required"
                    : !connected
                      ? "Connect Wallet"
                      : tooSmall
                        ? "Minimum 1 USDCx"
                        : insufficient
                          ? "Insufficient USDCx Balance"
                          : txLoading
                            ? "Depositing..."
                            : "Deposit Liquidity";
                  return (
                    <button
                      onClick={handleDeposit}
                      disabled={disabled}
                      className="w-full h-10 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {label}
                    </button>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        </main>

        <Footer />
      </div>
    </WalletGate>
  );
};

export default Pool;
