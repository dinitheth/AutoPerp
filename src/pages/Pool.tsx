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
  type TradingMode,
  getStoredTradingMode,
  LEGACY_SETTLEMENT_MESSAGE,
  REAL_SETTLEMENT_AVAILABLE,
  PUBLIC_CORE_PROGRAM,
  resolveCoreProgram,
  setStoredTradingMode,
} from "@/lib/protocol";
import { findPoolStateRecord } from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords } from "@/lib/walletRecords";
import { toast } from "sonner";

type LpCandidate = {
  input: string;
  shares: number;
  sourceProgram: string;
};

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

function extractRecordPlaintext(record: unknown): string {
  const source = record as Record<string, unknown>;
  return (
    (typeof source.recordPlaintext === "string" && source.recordPlaintext) ||
    (typeof source.plaintext === "string" && source.plaintext) ||
    (typeof source.record === "string" && source.record) ||
    (typeof source.data === "string" && source.data) ||
    (typeof record === "string" ? record : "")
  );
}

function parsePrivatePoolState(plain: string): { poolId: string; balance: number; fees: number; shares: number } | null {
  if (!plain) return null;
  if (!/pool_id\s*:/i.test(plain) || !/balance\s*:/i.test(plain) || !/fees\s*:/i.test(plain) || !/shares\s*:/i.test(plain)) {
    return null;
  }
  const poolMatch = plain.match(/pool_id\s*:\s*([^,\n}]+)/i);
  const balanceMatch = plain.match(/balance\s*:\s*([^,\n}]+)/i);
  const feesMatch = plain.match(/fees\s*:\s*([^,\n}]+)/i);
  const sharesMatch = plain.match(/shares\s*:\s*([^,\n}]+)/i);
  if (!poolMatch || !balanceMatch || !feesMatch || !sharesMatch) return null;

  const parseRaw = (value: string): number => {
    const cleaned = value
      .replace(/\.(private|public)$/i, "")
      .replace(/u\d+$/i, "")
      .replace(/_/g, "")
      .trim();
    const n = Number.parseInt(cleaned, 10);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    poolId: String(poolMatch[1]).replace(/\.(private|public)$/i, "").trim(),
    balance: parseRaw(balanceMatch[1]),
    fees: parseRaw(feesMatch[1]),
    shares: parseRaw(sharesMatch[1]),
  };
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
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => getStoredTradingMode());
  const [selectedPool, setSelectedPool] = useState(0);
  const [poolBalances, setPoolBalances] = useState<Record<string, number>>({});
  const [poolFees, setPoolFees] = useState<Record<string, number>>({});
  const [poolShares, setPoolShares] = useState<Record<string, number>>({});
  const [userLpByPool, setUserLpByPool] = useState<Record<string, number>>({});
  const [loadingPoolBalances, setLoadingPoolBalances] = useState(false);
  const [claimingFees, setClaimingFees] = useState(false);

  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { usdcxBalance, refetch: refetchBalance } = useUsdcxBalance();
  const { execute, loading: txLoading } = useAleoTransaction();
  const isPrivateMode = tradingMode === "private";
  const coreProgram = resolveCoreProgram(tradingMode);

  const refreshPoolBalances = useCallback(async () => {
    if (!REAL_SETTLEMENT_AVAILABLE) return;
    setLoadingPoolBalances(true);
    try {
      if (isPrivateMode) {
        if (!connected || !address) {
          setPoolBalances({});
          setPoolFees({});
          setPoolShares({});
          return;
        }

        const records = await requestProgramRecords(
          requestRecords,
          coreProgram,
          true,
          disconnect,
          connect,
        );

        const nextBalances: Record<string, number> = {};
        const nextFees: Record<string, number> = {};
        const nextShares: Record<string, number> = {};

        for (const p of pools) {
          nextBalances[p.poolId] = 0;
          nextFees[p.poolId] = 0;
          nextShares[p.poolId] = 0;
        }

        const owner = (address ?? "").trim().toLowerCase();
        for (const record of records) {
          const plain = extractRecordPlaintext(record);
          if (!plain || !/owner\s*:/i.test(plain)) continue;

          const ownerMatch = plain.match(/owner\s*:\s*([^,\n}]+)/i);
          const recOwner = ownerMatch
            ? String(ownerMatch[1]).replace(/\.(private|public)$/i, "").trim().toLowerCase()
            : "";
          if (!recOwner || recOwner !== owner) continue;

          const parsed = parsePrivatePoolState(plain);
          if (!parsed) continue;
          if (!Object.prototype.hasOwnProperty.call(nextBalances, parsed.poolId)) continue;

          nextBalances[parsed.poolId] = parsed.balance / 1_000_000;
          nextFees[parsed.poolId] = parsed.fees / 1_000_000;
          nextShares[parsed.poolId] = parsed.shares;
        }

        setPoolBalances(nextBalances);
        setPoolFees(nextFees);
        setPoolShares(nextShares);
        return;
      }

      const entries = await Promise.all(
        pools.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/program/${coreProgram}/mapping/pool_balance/${p.poolId}`);
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
            const res = await fetch(`${API_BASE}/program/${coreProgram}/mapping/pool_fees/${p.poolId}`);
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
            const res = await fetch(`${API_BASE}/program/${coreProgram}/mapping/pool_shares/${p.poolId}`);
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
    } catch (error) {
      if (isProgramNotAllowedError(error)) {
        toast.error("Shield blocked private pool record access. Reconnect wallet and approve program permissions.");
      }
    } finally {
      setLoadingPoolBalances(false);
    }
  }, [connected, address, requestRecords, disconnect, connect, isPrivateMode, coreProgram]);

  const refreshUserLp = useCallback(async () => {
    if (!connected) {
      setUserLpByPool({});
      return;
    }
    try {
      const records = await requestProgramRecords(
        requestRecords,
        coreProgram,
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
  }, [connected, requestRecords, disconnect, connect, coreProgram]);

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

    if (isPrivateMode) {
      const owner = address ?? "";

      const loadPool = async () => {
        const records = await requestProgramRecords(
          requestRecords,
          coreProgram,
          true,
          disconnect,
          connect,
        );
        return findPoolStateRecord(records, owner, pool.poolId);
      };

      let poolRecord = await loadPool();
      if (!poolRecord) {
        const bootstrapped = await execute(coreProgram, "bootstrap_pool", [pool.poolId, "0u64"]);
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

      result = await execute(coreProgram, "deposit_liquidity", [poolRecord.input, toUsdcx(depositAmount)]);
    } else {
      result = await execute(coreProgram, "deposit_liquidity", [pool.poolId, toUsdcx(depositAmount)]);
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

  const handleClaimFees = async () => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      return;
    }

    if (isPrivateMode) {
      toast.error("Claim to wallet is available only in Public mode. Switch mode and retry.");
      return;
    }

    if (!connected || !address) {
      toast.error("Connect your Shield wallet first.");
      return;
    }

    const pool = pools[selectedPool];
    setClaimingFees(true);
    try {
      const owner = (address ?? "").trim().toLowerCase();
      const lpPrograms = [PUBLIC_CORE_PROGRAM];
      const lpInputs: LpCandidate[] = [];

      for (const program of lpPrograms) {
        let records: unknown[] = [];
        try {
          records = await requestProgramRecords(
            requestRecords,
            program,
            true,
            disconnect,
            connect,
          );
        } catch {
          records = [];
        }

        for (const record of records) {
          const plain = extractRecordPlaintext(record);
          if (!plain) continue;
          if (!/pool_id\s*:/i.test(plain) || !/shares\s*:/i.test(plain) || !/deposit_amount\s*:/i.test(plain)) {
            continue;
          }

          const ownerMatch = plain.match(/owner\s*:\s*([^,\n}]+)/i);
          const recOwner = ownerMatch
            ? String(ownerMatch[1]).replace(/\.(private|public)$/i, "").trim().toLowerCase()
            : "";
          if (!recOwner || recOwner !== owner) continue;

          const poolMatch = plain.match(/pool_id\s*:\s*([^,\n}]+)/i);
          if (!poolMatch) continue;
          const poolId = String(poolMatch[1]).replace(/\.(private|public)$/i, "").trim();
          if (poolId !== pool.poolId) continue;

          const sharesMatch = plain.match(/shares\s*:\s*([^,\n}]+)/i);
          const sharesRaw = sharesMatch
            ? String(sharesMatch[1]).replace(/\.(private|public)$/i, "").replace(/u\d+$/i, "").replace(/_/g, "").trim()
            : "0";
          const shares = Number(sharesRaw);
          if (!Number.isFinite(shares) || shares <= 0) continue;

          lpInputs.push({ input: plain, shares, sourceProgram: program });
        }
      }

      const publicLpInputs = lpInputs.filter((x) => x.sourceProgram === PUBLIC_CORE_PROGRAM);
      if (publicLpInputs.length === 0) {
        if (lpInputs.length > 0) {
          toast.error("No public LP token found. Your LP record appears to be private-only, so public fee claim cannot execute from this account state.");
        } else {
          toast.error("No public LP token record found for this pool. Deposit to public pool first, then retry claim.");
        }
        return;
      }

      // Use the largest LP token record for claim to maximize payout in one call.
      publicLpInputs.sort((a, b) => b.shares - a.shares);
      const lpInput = publicLpInputs[0].input;

      const [sharesRes, feesRes] = await Promise.all([
        fetch(`${API_BASE}/program/${PUBLIC_CORE_PROGRAM}/mapping/pool_shares/${pool.poolId}`),
        fetch(`${API_BASE}/program/${PUBLIC_CORE_PROGRAM}/mapping/pool_fees/${pool.poolId}`),
      ]);

      if (!sharesRes.ok || !feesRes.ok) {
        toast.error("Could not load latest pool share/fee state for claim.");
        return;
      }

      const totalSharesRaw = parseMappingBalance(await sharesRes.text());
      const totalFeesRaw = parseMappingBalance(await feesRes.text());

      if (totalSharesRaw <= 0) {
        toast.error("Pool has zero shares. Claim unavailable.");
        return;
      }

      if (totalFeesRaw <= 0) {
        toast.info("No claimable fees available right now.");
        return;
      }

      const result = await execute(
        PUBLIC_CORE_PROGRAM,
        "claim_fees",
        [lpInput, `${totalSharesRaw}u64`, `${totalFeesRaw}u64`],
        1_000_000,
      );

      if (result) {
        toast.success("Fees claimed to wallet successfully.");
        setTimeout(() => refreshPoolBalances(), 2000);
        setTimeout(() => refreshPoolBalances(), 7000);
        setTimeout(() => refetchBalance(), 2000);
        setTimeout(() => refetchBalance(), 7000);
      }
    } catch (error) {
      if (isProgramNotAllowedError(error)) {
        toast.error("Shield blocked LP record access. Reconnect wallet and approve program permissions.");
      } else {
        const message = error instanceof Error ? error.message : "Fee claim failed.";
        toast.error(message);
      }
    } finally {
      setClaimingFees(false);
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

              <div className="mb-6 flex items-center justify-end gap-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Mode</span>
                <div className="inline-flex rounded-lg border border-border bg-card p-1">
                  <button
                    onClick={() => {
                      setTradingMode("private");
                      setStoredTradingMode("private");
                    }}
                    className={cn(
                      "h-7 px-3 text-xs rounded-md transition-colors",
                      isPrivateMode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Private
                  </button>
                  <button
                    onClick={() => {
                      setTradingMode("public");
                      setStoredTradingMode("public");
                    }}
                    className={cn(
                      "h-7 px-3 text-xs rounded-md transition-colors",
                      !isPrivateMode
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Public
                  </button>
                </div>
              </div>

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
                  { icon: Lock, label: "Privacy", value: "Hybrid" },
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
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lock Period</span>
                    <span className="text-warning text-[10px]">Deposited liquidity is locked for 2 years</span>
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

                <button
                  onClick={handleClaimFees}
                  disabled={txLoading || claimingFees || !connected || isPrivateMode}
                  className="mt-3 w-full h-10 text-sm font-medium rounded-xl border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                >
                  {claimingFees
                    ? "Claiming Public Fees..."
                    : isPrivateMode
                      ? "Switch to Public Mode to Claim Fees"
                    : selectedPoolClaimableFees > 0
                      ? `Claim Public Fees to Wallet (${selectedPoolClaimableFees.toFixed(2)} USDCx est)`
                      : "Claim Public Fees to Wallet"}
                </button>
                {isPrivateMode && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Claim fees is public only.
                  </p>
                )}
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
