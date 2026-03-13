import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { PROGRAMS } from "@/lib/protocol";

const CREDITS_PROGRAM = "credits.aleo";
const USDCX_PROGRAM = "test_usdcx_stablecoin.aleo";
const VAULT_PROGRAM = PROGRAMS.CORE;
const API_BASE = "https://api.explorer.provable.com/v1/testnet";

function parseUnsignedInt(raw: string): number {
  const cleaned = raw
    .replace(/"/g, "")
    .replace(/u\d+$/i, "")
    .replace(/field$/i, "")
    .replace(/_/g, "")
    .trim();

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

const useUsdcxBalance = () => {
  const { connected, address } = useWallet();
  const [usdcxBalance, setUsdcxBalance] = useState<string | null>(null);
  const [vaultBalance, setVaultBalance] = useState<string | null>(null);
  const [creditsBalance, setCreditsBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorCountRef = useRef(0);

  const fetchBalances = useCallback(async () => {
    if (!connected || !address) {
      setUsdcxBalance(null);
      setCreditsBalance(null);
      return;
    }

    setLoading(true);
    try {
      let usdcxMicro = 0;

      try {
        const res = await fetch(`${API_BASE}/program/${USDCX_PROGRAM}/mapping/balances/${address}`);
        if (res.ok) {
          const data = await res.text();
          usdcxMicro = parseMappingBalance(data);
        }
      } catch {
        // ignore
      }

      setUsdcxBalance((usdcxMicro / 1_000_000).toFixed(2));

      try {
        const vres = await fetch(`${API_BASE}/program/${VAULT_PROGRAM}/mapping/vault/${address}`);
        if (vres.ok) {
          const vdata = await vres.text();
          const vmicro = parseMappingBalance(vdata);
          setVaultBalance((vmicro / 1_000_000).toFixed(2));
        } else {
          setVaultBalance("0.00");
        }
      } catch {
        setVaultBalance("0.00");
      }

      try {
        const res = await fetch(`${API_BASE}/program/${CREDITS_PROGRAM}/mapping/account/${address}`);
        if (res.ok) {
          const data = await res.text();
          const creditsMicro = parseUnsignedInt(data);
          setCreditsBalance((creditsMicro / 1_000_000).toFixed(2));
        } else {
          setCreditsBalance("0.00");
        }
      } catch {
        setCreditsBalance("0.00");
      }
    } catch (err) {
      if (errorCountRef.current < 3) {
        console.error("[useUsdcxBalance] Balance fetch error:", err);
      }
      errorCountRef.current++;
      setUsdcxBalance("0.00");
      setCreditsBalance("0.00");
    } finally {
      setLoading(false);
    }
  }, [connected, address]);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 15000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return {
    usdcxBalance,
    vaultBalance,
    creditsBalance,
    loading,
    refetch: fetchBalances,
  };
};

export default useUsdcxBalance;
