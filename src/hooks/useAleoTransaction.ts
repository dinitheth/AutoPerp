// AutoPerp on-chain transaction execution via Shield wallet
// Pattern taken exactly from official Aleo Dev Toolkit documentation:
// https://aleo-dev-toolkit-documentation.vercel.app/docs/wallet-adapter#-executing-transactions
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { WalletReadyState } from "@provablehq/aleo-wallet-standard";
import { Network, type TransactionOptions } from "@provablehq/aleo-types";
import { toast } from "sonner";
import { PROGRAMS } from "@/lib/protocol";

const EXPLORER_BASE = "https://testnet.explorer.provable.com";
const EXPLORER_TX = (txId: string) => `${EXPLORER_BASE}/transaction/${txId}`;

export interface TransactionResult {
  transactionId: string;
  submittedId?: string;
}

interface ExecuteOptions {
  suppressSuccessToast?: boolean;
}

function normalizeTxError(
  status: string,
  rawError: string | undefined,
  functionName?: string,
): string {
  const base = (rawError ?? "").trim();
  const lower = base.toLowerCase();

  if (lower.includes("assert") || lower.includes("assertion")) {
    if (functionName === "close_position") {
      return "Close rejected by on-chain assertion. Most common causes: stale/consumed position record, owner mismatch, or invalid current price.";
    }
    return `On-chain assertion failed${base ? `: ${base}` : ""}`;
  }

  if (
    lower.includes("proof") ||
    lower.includes("prover") ||
    lower.includes("witness") ||
    lower.includes("nullifier")
  ) {
    return `Proof generation/spendability failure${base ? `: ${base}` : ""}`;
  }

  if (
    lower.includes("reject") ||
    lower.includes("rejected") ||
    lower.includes("denied") ||
    lower.includes("cancel")
  ) {
    return base || `Transaction ${status}: rejected by wallet/network.`;
  }

  if (!base || lower === "unknown error" || lower === "unknown") {
    if (functionName === "close_position") {
      return "Close transaction rejected (unknown reason). Possible causes: stale record, prover reject, or public close arithmetic overflow at large notional. The app will attempt safety fallback.";
    }
    if (functionName === "deposit_collateral") {
      return `Transaction ${status}: deposit_collateral failed. Check that you have sufficient USDCx balance AND enough Aleo credits for the fee.`;
    }
    if (functionName === "open_position") {
      return `Transaction ${status}: open_position failed. Ensure you have deposited collateral first and have enough Aleo credits for the fee.`;
    }
    return `Transaction ${status}: unknown failure from wallet/network. Common causes: insufficient USDCx balance, insufficient Aleo credits for fee, or on-chain assertion failure.`;
  }

  return base;
}

function isDuplicateInputLedgerError(message?: string): boolean {
  const lower = (message ?? "").toLowerCase();
  return lower.includes("already exists in the ledger") || lower.includes("input id");
}

function isWalletLockedError(message?: string): boolean {
  const lower = (message ?? "").toLowerCase();
  return (
    lower.includes("wallet locked") ||
    lower.includes("is locked") ||
    lower.includes("unlock") ||
    lower.includes("password") ||
    lower.includes("pin") ||
    lower.includes("not authenticated") ||
    lower.includes("authentication required")
  );
}

const TX_DEBUG = import.meta.env.DEV;

function txDebug(message: string, meta?: Record<string, unknown>) {
  if (!TX_DEBUG) return;
  if (meta) {
    console.debug(message, meta);
    return;
  }
  console.debug(message);
}

export function useAleoTransaction() {
  const {
    executeTransaction,
    transactionStatus,
    connected,
    address,
    wallet,
    wallets,
    selectWallet,
    connect,
  } = useWallet();

  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setError = useCallback((msg: string | null) => {
    lastErrorRef.current = msg;
    setLastError(msg);
  }, []);

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const pollTransactionStatus = useCallback(
    async (
      tempTransactionId: string,
      toastId: string | number,
      functionName: string,
      options: ExecuteOptions | undefined,
      resolve: (result: TransactionResult | null) => void,
    ) => {
      try {
        const statusResponse = await transactionStatus(tempTransactionId);
        txDebug("[TX Poll] Status update", {
          status: statusResponse.status,
          hasOnChainId: !!statusResponse.transactionId,
        });

        if (statusResponse.status.toLowerCase() !== "pending") {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          if (statusResponse.status.toLowerCase() === "accepted") {
            const onChainId = statusResponse.transactionId || tempTransactionId;
            toast.dismiss(toastId);
            if (!options?.suppressSuccessToast) {
              toast.success("Transaction confirmed on Aleo blockchain!", {
                duration: 8000,
                action: {
                  label: "View Explorer",
                  onClick: () => window.open(EXPLORER_TX(onChainId), "_blank"),
                },
              });
            }
            setLoading(false);
            setError(null);
            resolve({ transactionId: onChainId, submittedId: tempTransactionId });
          } else if (
            statusResponse.status.toLowerCase() === "failed" ||
            statusResponse.status.toLowerCase() === "rejected"
          ) {
            const normalized = normalizeTxError(
              statusResponse.status,
              statusResponse.error,
              functionName,
            );
            setError(normalized);
            toast.dismiss(toastId);
            if (isDuplicateInputLedgerError(normalized)) {
              toast.info("Previous private transaction is still finalizing. Wait a few seconds, refresh records, then retry.");
            } else {
              toast.error(`Transaction ${statusResponse.status}: ${normalized}`);
            }
            setLoading(false);
            resolve(null);
          } else {
            const onChainId = statusResponse.transactionId || tempTransactionId;
            toast.dismiss(toastId);
            if (!options?.suppressSuccessToast) {
              toast.success(`Transaction ${statusResponse.status}!`, {
                duration: 8000,
                action: {
                  label: "View Explorer",
                  onClick: () => window.open(EXPLORER_TX(onChainId), "_blank"),
                },
              });
            }
            setLoading(false);
            setError(null);
            resolve({ transactionId: onChainId, submittedId: tempTransactionId });
          }
        }
      } catch (error) {
        txDebug("[TX Poll] Error during status check", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        toast.dismiss(toastId);
        setError("Could not confirm transaction status");
        toast.error(
          "Could not confirm transaction status. Check Aleo Explorer for your transaction.",
          {
            description: `Shield TX ID: ${tempTransactionId}`,
            duration: 15000,
            action: {
              label: "Open Explorer",
              onClick: () => window.open(EXPLORER_BASE, "_blank"),
            },
          },
        );
        setLoading(false);
        resolve(null);
      }
    },
    [transactionStatus, setError],
  );

  const ensureShieldConnection = useCallback(async (): Promise<boolean> => {
    const shieldWallet = wallets.find(({ adapter }) =>
      String(adapter.name).toLowerCase().includes("shield"),
    );

    if (!shieldWallet) {
      setError("Shield wallet not detected");
      toast.error("Shield wallet not detected. Please install Shield.");
      return false;
    }

    const shieldInstalled =
      shieldWallet.readyState === WalletReadyState.INSTALLED ||
      shieldWallet.readyState === WalletReadyState.LOADABLE;

    if (!shieldInstalled) {
      setError("Shield wallet extension not installed");
      toast.error("Shield wallet extension not installed.");
      window.open("https://aleo.org/shield/", "_blank");
      return false;
    }

    if (wallet?.adapter.name !== shieldWallet.adapter.name) {
      selectWallet(shieldWallet.adapter.name);
    }

    if (!connected) {
      try {
        await connect(Network.TESTNET);
      } catch {
        setError("Failed to connect to Shield wallet");
        toast.error("Failed to connect to Shield wallet. Please connect manually.");
        return false;
      }
    }

    return true;
  }, [wallets, wallet, selectWallet, connected, connect, setError]);

  const execute = useCallback(
    async (
      program: string,
      functionName: string,
      inputs: string[],
      fee?: number,
      options?: ExecuteOptions,
    ): Promise<TransactionResult | null> => {
      setError(null);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      const shieldReady = await ensureShieldConnection().catch(() => false);
      if (!shieldReady) return null;

      if (!connected || !address || !executeTransaction) {
        setError("Wallet not connected");
        toast.error("Wallet not connected. Please connect your Shield wallet.");
        return null;
      }

      setLoading(true);
      const toastId = toast.loading(`Opening Shield wallet for approval... (${functionName})`);

      const transactionOptions: TransactionOptions = {
        program,
        function: functionName,
        inputs,
        fee: fee ?? 1_000_000,
        privateFee: false,
      };

      txDebug("[TX Execute] Submission", {
        program,
        function: functionName,
        inputCount: inputs.length,
        fee: transactionOptions.fee,
      });

      try {
        const result = await executeTransaction(transactionOptions);
        const tempId = result?.transactionId;
        txDebug("[TX Execute] Temporary transaction ID received", {
          hasTempId: !!tempId,
        });

        if (!tempId) {
          setError("No response from Shield wallet. If Shield is locked, unlock it and retry.");
          toast.dismiss(toastId);
          toast.error("No response from Shield wallet. Unlock Shield and retry.");
          setLoading(false);
          return null;
        }

        toast.loading("Transaction approved! Shield is generating ZK proof (1-3 mins)...", {
          id: toastId,
        });

        return new Promise<TransactionResult | null>((resolve) => {
          pollingIntervalRef.current = setInterval(() => {
            pollTransactionStatus(tempId, toastId, functionName, options, resolve);
          }, 1000);

          pollTransactionStatus(tempId, toastId, functionName, options, resolve);

          setTimeout(() => {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
              toast.dismiss(toastId);
              setError("Transaction confirmation timeout");
              toast.info("Still processing - check Aleo Explorer for your transaction.", {
                description: `Shield TX ID: ${tempId}`,
                duration: 20000,
                action: {
                  label: "Open Explorer",
                  onClick: () => window.open(EXPLORER_BASE, "_blank"),
                },
              });
              setLoading(false);
              resolve(null);
            }
          }, 600_000);
        });
      } catch (error: unknown) {
        toast.dismiss(toastId);
        const message = error instanceof Error ? error.message : "Transaction failed.";
        console.error("[TX Execute] Error:", error);
        setError(message);

        if (
          isWalletLockedError(message)
        ) {
          setError("Shield wallet appears locked. Unlock Shield and retry.");
          toast.error("Shield wallet appears locked. Unlock it and retry.");
        } else if (
          message.toLowerCase().includes("reject") ||
          message.toLowerCase().includes("cancel") ||
          message.toLowerCase().includes("denied") ||
          message.toLowerCase().includes("user refused")
        ) {
          toast.error("Transaction rejected in Shield wallet.");
        } else {
          toast.error(`Transaction error: ${message}`);
        }

        setLoading(false);
        return null;
      }
    },
    [ensureShieldConnection, executeTransaction, connected, address, pollTransactionStatus, setError],
  );

  const getLastError = useCallback(() => lastErrorRef.current, []);
  return { execute, loading, lastError, getLastError };
}

export { PROGRAMS } from "@/lib/protocol";

export const API_BASE = "https://api.explorer.provable.com/v1/testnet";

export const MARKET_IDS: Record<string, string> = {
  "BTC-USD": "0u8",
  "ETH-USD": "1u8",
};

export function toUsdcx(amount: number): string {
  return `${Math.floor(amount * 1_000_000)}u64`;
}

export function toPrice(amount: number): string {
  return `${Math.floor(amount * 100_000_000)}u64`;
}

export async function fetchVaultBalance(address: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/program/${PROGRAMS.CORE}/mapping/vault/${address}`);
    if (!res.ok) return 0;
    const raw = await res.text();
    const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n / 1_000_000 : 0;
  } catch {
    return 0;
  }
}

// ==================== Oracle Queries (cross-program reads) ====================

/** Read oracle price for a market from autoperp_oracle_v2.aleo */
export async function fetchOraclePrice(marketId: number): Promise<number> {
  try {
    const res = await fetch(
      `${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/prices/${marketId}u8`,
    );
    if (!res.ok) return 0;
    const raw = await res.text();
    const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n / 100_000_000 : 0; // 8-decimal precision
  } catch {
    return 0;
  }
}

/** Read mark price (TWAP) from oracle */
export async function fetchMarkPrice(marketId: number): Promise<number> {
  try {
    const res = await fetch(
      `${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/mark_prices/${marketId}u8`,
    );
    if (!res.ok) return 0;
    const raw = await res.text();
    const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
    const n = parseInt(cleaned, 10);
    return Number.isFinite(n) ? n / 100_000_000 : 0;
  } catch {
    return 0;
  }
}

/** Read funding rate from oracle (returns rate * 1_000_000) */
export async function fetchFundingRate(marketId: number): Promise<{ rate: number; direction: number }> {
  try {
    const [rateRes, dirRes] = await Promise.all([
      fetch(`${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/funding_rates/${marketId}u8`),
      fetch(`${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/funding_direction/${marketId}u8`),
    ]);
    let rate = 0;
    let direction = 0;
    if (rateRes.ok) {
      const raw = await rateRes.text();
      const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
      const n = parseInt(cleaned, 10);
      rate = Number.isFinite(n) ? n / 1_000_000 : 0;
    }
    if (dirRes.ok) {
      const raw = await dirRes.text();
      const cleaned = raw.replace(/"/g, "").replace(/u8$/i, "").trim();
      direction = parseInt(cleaned, 10) || 0;
    }
    return { rate, direction };
  } catch {
    return { rate: 0, direction: 0 };
  }
}

/** Read raw funding rate and direction as on-chain u64/u8 for contract inputs */
export async function fetchFundingRateRaw(marketId: number): Promise<{ rateU64: string; directionU8: string }> {
  try {
    const [rateRes, dirRes] = await Promise.all([
      fetch(`${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/funding_rates/${marketId}u8`),
      fetch(`${API_BASE}/program/${PROGRAMS.ORACLE}/mapping/funding_direction/${marketId}u8`),
    ]);
    let rateU64 = "0u64";
    let directionU8 = "0u8";
    if (rateRes.ok) {
      const raw = await rateRes.text();
      const cleaned = raw.replace(/"/g, "").replace(/_/g, "").trim();
      // Already in on-chain format like "1234u64"
      rateU64 = /^\d+u64$/i.test(cleaned) ? cleaned : `${parseInt(cleaned, 10) || 0}u64`;
    }
    if (dirRes.ok) {
      const raw = await dirRes.text();
      const cleaned = raw.replace(/"/g, "").trim();
      directionU8 = /^\d+u8$/i.test(cleaned) ? cleaned : `${parseInt(cleaned, 10) || 0}u8`;
    }
    return { rateU64, directionU8 };
  } catch {
    return { rateU64: "0u64", directionU8: "0u8" };
  }
}

/** Read next_position_id from on-chain mapping for a specific market */
export async function fetchNextPositionId(program: string, marketId: number): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/program/${program}/mapping/next_position_id/${marketId}u8`);
    if (!res.ok) return "1u64"; // Default start
    const raw = await res.text();
    const cleaned = raw.replace(/"/g, "").replace(/_/g, "").trim();
    return /^\d+u64$/i.test(cleaned) ? cleaned : `${parseInt(cleaned, 10) || 1}u64`;
  } catch {
    return "1u64";
  }
}

/** Read pool balance and shares for NAV-based LP share computation */
export async function fetchPoolState(program: string, poolId: number): Promise<{ balance: number; shares: number }> {
  try {
    const [balRes, sharesRes] = await Promise.all([
      fetch(`${API_BASE}/program/${program}/mapping/pool_balance/${poolId}u8`),
      fetch(`${API_BASE}/program/${program}/mapping/pool_shares/${poolId}u8`),
    ]);
    let balance = 0;
    let shares = 0;
    if (balRes.ok) {
      const raw = await balRes.text();
      const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
      balance = parseInt(cleaned, 10) || 0;
    }
    if (sharesRes.ok) {
      const raw = await sharesRes.text();
      const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").replace(/_/g, "").trim();
      shares = parseInt(cleaned, 10) || 0;
    }
    return { balance, shares };
  } catch {
    return { balance: 0, shares: 0 };
  }
}

/** Compute NAV-based LP shares: if pool empty → amount, else → (amount * total_shares) / pool_balance */
export function computeNavShares(amountMicro: number, poolBalance: number, poolShares: number): string {
  if (poolBalance > 0 && poolShares > 0) {
    const shares = Math.floor((amountMicro * poolShares) / poolBalance);
    return `${shares}u64`;
  }
  return `${amountMicro}u64`;
}


