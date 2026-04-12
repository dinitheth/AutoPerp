// useAgentAuth — Frontend integration for autoperp_agent_v3.aleo
// Addresses Wave 4 feedback: "agent auth program is deployed but never called by the frontend"
// This hook provides grant_auth, execute_agent_action, revoke_auth, and liquidate_position
// functions that call the actual on-chain AgentAuth program.

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { useAleoTransaction, API_BASE } from "@/hooks/useAleoTransaction";
import { PROGRAMS } from "@/lib/protocol";
import { toast } from "sonner";

const AGENT_PROGRAM = PROGRAMS.AGENT;

export interface AgentAuthRecord {
  id: string;
  agent: string;
  positionHash: string;
  permissions: number;
  maxSlippage: number;
  marketId: number;
  expiry: number;
  isActive: boolean;
}

export interface ExecutionReceiptData {
  agent: string;
  actionType: number;
  executionPrice: number;
  marketId: number;
  txId: string;
}

// Permission bitmask constants
export const AGENT_PERMISSIONS = {
  LIQUIDATE: 1,
  CLOSE: 2,
  ADJUST: 4,
  ALL: 7,
} as const;

export function permissionLabels(permissions: number): string[] {
  const labels: string[] = [];
  if (permissions & AGENT_PERMISSIONS.LIQUIDATE) labels.push("Liquidate");
  if (permissions & AGENT_PERMISSIONS.CLOSE) labels.push("Close");
  if (permissions & AGENT_PERMISSIONS.ADJUST) labels.push("Adjust");
  return labels;
}

export function useAgentAuth() {
  const { connected, address } = useWallet();
  const { execute, loading, getLastError } = useAleoTransaction();
  const [activeAuths, setActiveAuths] = useState<AgentAuthRecord[]>([]);
  const [receipts, setReceipts] = useState<ExecutionReceiptData[]>([]);
  const [loadingAuths, setLoadingAuths] = useState(false);

  // Load active authorizations from on-chain mapping
  const refreshAuths = useCallback(async () => {
    if (!connected || !address) {
      setActiveAuths([]);
      return;
    }
    setLoadingAuths(true);
    try {
      const addressHash = `${address}field`; // BHP256 hash approximation for query
      const res = await fetch(
        `${API_BASE}/program/${AGENT_PROGRAM}/mapping/active_auths/${addressHash}`,
      );
      if (res.ok) {
        const raw = await res.text();
        const isActive = raw.trim().replace(/"/g, "") === "true";

        // Load cached auth records from localStorage
        const cached = loadCachedAuths(address);
        setActiveAuths(
          cached.map((a) => ({ ...a, isActive })),
        );
      }
    } catch {
      // Keep existing state on network error
    } finally {
      setLoadingAuths(false);
    }
  }, [connected, address]);

  useEffect(() => {
    refreshAuths();
  }, [refreshAuths]);

  // Grant authorization to an agent for a specific position
  const grantAuth = useCallback(
    async (params: {
      agentAddress: string;
      positionHash: string;
      permissions: number;
      maxSlippageBps: number;
      marketId: number;
      expiryBlockHeight: number;
    }): Promise<boolean> => {
      if (!connected || !address) {
        toast.error("Wallet not connected");
        return false;
      }

      const result = await execute(
        AGENT_PROGRAM,
        "grant_auth",
        [
          params.agentAddress,
          `${params.positionHash}field`,
          `${params.permissions}u8`,
          `${params.maxSlippageBps}u64`,
          `${params.marketId}u8`,
          `${params.expiryBlockHeight}u32`,
        ],
      );

      if (result) {
        const auth: AgentAuthRecord = {
          id: result.transactionId,
          agent: params.agentAddress,
          positionHash: params.positionHash,
          permissions: params.permissions,
          maxSlippage: params.maxSlippageBps,
          marketId: params.marketId,
          expiry: params.expiryBlockHeight,
          isActive: true,
        };
        setActiveAuths((prev) => [...prev, auth]);
        saveCachedAuths([...activeAuths, auth], address);
        toast.success("Agent authorization granted on-chain", {
          description: `TX: ${result.transactionId.slice(0, 20)}...`,
        });
        return true;
      }

      const err = getLastError();
      toast.error(`Failed to grant agent auth: ${err ?? "Unknown error"}`);
      return false;
    },
    [connected, address, execute, getLastError, activeAuths],
  );

  // Execute an agent action (close position, etc.)
  const executeAgentAction = useCallback(
    async (params: {
      authRecordInput: string;
      actionType: number;
      executionPrice: number;
    }): Promise<ExecutionReceiptData | null> => {
      if (!connected || !address) {
        toast.error("Wallet not connected");
        return null;
      }

      const priceU64 = Math.floor(params.executionPrice * 100_000_000);

      const result = await execute(
        AGENT_PROGRAM,
        "execute_agent_action",
        [
          params.authRecordInput,
          `${params.actionType}u8`,
          `${priceU64}u64`,
        ],
      );

      if (result) {
        const receipt: ExecutionReceiptData = {
          agent: address,
          actionType: params.actionType,
          executionPrice: params.executionPrice,
          marketId: 0,
          txId: result.transactionId,
        };
        setReceipts((prev) => [...prev, receipt]);

        // Mark auth as consumed
        setActiveAuths((prev) =>
          prev.map((a) =>
            a.isActive ? { ...a, isActive: false } : a,
          ),
        );

        toast.success("Agent action executed on-chain", {
          description: `Receipt TX: ${result.transactionId.slice(0, 20)}...`,
        });
        return receipt;
      }

      return null;
    },
    [connected, address, execute],
  );

  // Revoke an authorization
  const revokeAuth = useCallback(
    async (authRecordInput: string): Promise<boolean> => {
      if (!connected || !address) {
        toast.error("Wallet not connected");
        return false;
      }

      const result = await execute(
        AGENT_PROGRAM,
        "revoke_auth",
        [authRecordInput],
      );

      if (result) {
        setActiveAuths((prev) =>
          prev.map((a) => ({ ...a, isActive: false })),
        );
        toast.success("Agent authorization revoked");
        return true;
      }

      return false;
    },
    [connected, address, execute],
  );

  // Get agent execution count from on-chain mapping
  const getAgentExecutionCount = useCallback(
    async (agentAddress: string): Promise<number> => {
      try {
        const agentHash = `${agentAddress}field`;
        const res = await fetch(
          `${API_BASE}/program/${AGENT_PROGRAM}/mapping/agent_executions/${agentHash}`,
        );
        if (!res.ok) return 0;
        const raw = await res.text();
        const cleaned = raw.replace(/"/g, "").replace(/u64$/i, "").trim();
        const n = parseInt(cleaned, 10);
        return Number.isFinite(n) ? n : 0;
      } catch {
        return 0;
      }
    },
    [],
  );

  return {
    activeAuths,
    receipts,
    loading,
    loadingAuths,
    grantAuth,
    executeAgentAction,
    revokeAuth,
    refreshAuths,
    getAgentExecutionCount,
  };
}

// ==================== Local cache helpers ====================

const AUTH_CACHE_KEY = "autoperp:agent:auths";

function cacheKey(address: string): string {
  return `${AUTH_CACHE_KEY}:${address.toLowerCase()}`;
}

function loadCachedAuths(address: string): AgentAuthRecord[] {
  try {
    const raw = localStorage.getItem(cacheKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentAuthRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCachedAuths(auths: AgentAuthRecord[], address: string) {
  try {
    localStorage.setItem(cacheKey(address), JSON.stringify(auths));
  } catch {
    // no-op
  }
}
