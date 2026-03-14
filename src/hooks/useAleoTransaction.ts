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
    return `Transaction ${status}: unknown failure from wallet/network.`;
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
  "ALEO-USD": "2u8",
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
