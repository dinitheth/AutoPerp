import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Lock, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import {
  useAleoTransaction,
  API_BASE,
  toPrice,
  toUsdcx,
} from "@/hooks/useAleoTransaction";
import usePrices from "@/hooks/usePrices";
import { LEGACY_SETTLEMENT_MESSAGE, REAL_SETTLEMENT_AVAILABLE } from "@/lib/protocol";
import { PRIVATE_CORE_PROGRAM, PUBLIC_CORE_PROGRAM } from "@/lib/protocol";
import { addTradeEvent, newId } from "@/lib/portfolioStore";
import {
  getPositionRecordOwner,
  isLikelyPositionRecord,
  isRecordSpent,
  parseAleoPositionRecord,
  serializePositionRecordInput,
} from "@/lib/positionRecord";
import { findPoolStateRecord, findVaultRecord } from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords, requestProgramRecordsAny } from "@/lib/walletRecords";

const POSITIONS_SNAPSHOT_KEY = "autoperp:positions:snapshot";
const CLOSED_POSITIONS_KEY = "autoperp:positions:closed";

function hashText(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
}

function positionSignature(pos: Pick<PositionRecord, "positionId" | "market" | "direction" | "entryPrice" | "collateral" | "leverage">): string {
  return [
    pos.positionId,
    pos.market,
    pos.direction,
    pos.entryPrice.toFixed(8),
    pos.collateral.toFixed(6),
    String(pos.leverage),
  ].join("|");
}

function recordFingerprint(rawData?: unknown): string | null {
  const input = serializePositionRecordInput(rawData);
  if (!input) return null;
  return hashText(input);
}

function dedupePositions(rows: PositionRecord[]): PositionRecord[] {
  const seen = new Set<string>();
  const out: PositionRecord[] = [];
  for (const row of rows) {
    const key = row.recordFp ? `rec:${row.recordFp}` : `sig:${row.signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function snapshotKey(address?: string | null): string {
  const scope = (address ?? "").trim().toLowerCase() || "guest";
  return `${POSITIONS_SNAPSHOT_KEY}:${scope}`;
}

function closedSnapshotKey(address?: string | null): string {
  const scope = (address ?? "").trim().toLowerCase() || "guest";
  return `${CLOSED_POSITIONS_KEY}:${scope}`;
}

function loadClosedPositionIds(address?: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(closedSnapshotKey(address));
    if (!raw) return new Set<string>();
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return new Set<string>();
    return new Set(arr.filter(Boolean));
  } catch {
    return new Set<string>();
  }
}

function saveClosedPositionIds(ids: Set<string>, address?: string | null) {
  try {
    localStorage.setItem(closedSnapshotKey(address), JSON.stringify(Array.from(ids)));
  } catch {
    // no-op
  }
}

function savePositionsSnapshot(positions: PositionRecord[], address?: string | null) {
  try {
    const serializable = positions.map((p) => ({
      id: p.id,
      market: p.market,
      direction: p.direction,
      collateral: p.collateral,
      size: p.size,
      leverage: p.leverage,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      pnl: p.pnl,
      pnlPercent: p.pnlPercent,
    }));
    localStorage.setItem(snapshotKey(address), JSON.stringify(serializable));
    window.dispatchEvent(new Event("autoperp:positions-snapshot-changed"));
  } catch {
    // no-op
  }
}

interface PositionRecord {
  id: string;
  positionId: string;
  market: string;
  direction: "long" | "short";
  collateral: number;
  size: number;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  agentActive: boolean;
  stopLoss: number;
  takeProfit: number;
  rawData?: unknown;
  signature: string;
  recordFp: string | null;
}

const MARKET_NAMES: Record<string, string> = {
  "0": "BTC-USD",
  "1": "ETH-USD",
  "2": "ALEO-USD",
};

const MARKET_IDS: Record<string, string> = {
  "BTC-USD": "0u8",
  "ETH-USD": "1u8",
  "ALEO-USD": "2u8",
};

function parseMappingBalance(raw: string): number {
  const structMatch = raw.match(/balance:\s*([\d_]+)u(?:64|128)/i);
  const value = structMatch?.[1] ?? raw;
  const cleaned = value
    .replace(/"/g, "")
    .replace(/u\d+$/i, "")
    .replace(/field$/i, "")
    .replace(/_/g, "")
    .trim();
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchPublicVaultUsdcx(program: string, owner: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/program/${program}/mapping/vault/${owner}`);
    if (!res.ok) return 0;
    const raw = await res.text();
    return parseMappingBalance(raw) / 1_000_000;
  } catch {
    return 0;
  }
}

function ownerFromRecordInput(input: string): string | null {
  const m = input.match(/owner\s*:\s*([^,\n}]+)/i);
  if (!m?.[1]) return null;
  return m[1].replace(/\.(private|public)$/i, "").trim().toLowerCase();
}

interface PositionsListProps {
  coreProgram: string;
  isPrivateMode: boolean;
}

const PositionsList = ({ coreProgram, isPrivateMode }: PositionsListProps) => {
  const [tab, setTab] = useState<"positions" | "orders" | "history">("positions");
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const permissionToastShownRef = useRef(false);
  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { execute, loading: txLoading, getLastError } = useAleoTransaction();
  const { prices, getPrice } = usePrices();
  const closeFailureCountRef = useRef<Record<string, number>>({});
  const closedPositionIdsRef = useRef<Set<string>>(loadClosedPositionIds(address));
  const positionRecordProgramCandidates = isPrivateMode
    ? [coreProgram, PRIVATE_CORE_PROGRAM]
    : [coreProgram, PUBLIC_CORE_PROGRAM];

  const fetchPositions = useCallback(async () => {
    if (!connected) {
      setPositions([]);
      return;
    }
    setLoadingRecords(true);
    try {
      const allRecords = await requestProgramRecordsAny(
        requestRecords,
        positionRecordProgramCandidates,
        true,
        disconnect,
        connect,
      );
      const parsed = allRecords
        .filter((r) => !isRecordSpent(r))
        .filter(isLikelyPositionRecord)
        .map((r) => parseAleoPositionRecord(r, MARKET_NAMES))
        .filter((p): p is NonNullable<ReturnType<typeof parseAleoPositionRecord>> => p !== null)
        .map((p) => {
          const candidate: PositionRecord = {
            id: p.id,
            positionId: p.positionId,
            market: p.market,
            direction: p.direction,
            collateral: p.collateral,
            size: p.size,
            leverage: p.leverage,
            entryPrice: p.entryPrice,
            markPrice: p.entryPrice,
            pnl: 0,
            pnlPercent: 0,
            agentActive: p.stopLoss > 0 || p.takeProfit > 0,
            stopLoss: p.stopLoss,
            takeProfit: p.takeProfit,
            rawData: p.rawData,
            signature: "",
            recordFp: recordFingerprint(p.rawData),
          };
          candidate.signature = positionSignature(candidate);
          return candidate;
        })
        .filter((p) => {
          const closed = closedPositionIdsRef.current;
          if (closed.has(`id:${p.id}`)) return false;
          if (closed.has(`sig:${p.signature}`)) return false;
          if (p.recordFp && closed.has(`rec:${p.recordFp}`)) return false;
          return true;
        });

      const deduped = dedupePositions(parsed);

      // Update mark prices and PnL
      const updated = deduped.map((pos) => {
        const live = getPrice(pos.market)?.price;
        const markPrice = Number.isFinite(live) && (live ?? 0) > 0 ? (live as number) : pos.entryPrice;
        let pnl: number;
        if (pos.direction === "long") {
          pnl = pos.size * ((markPrice - pos.entryPrice) / pos.entryPrice);
        } else {
          pnl = pos.size * ((pos.entryPrice - markPrice) / pos.entryPrice);
        }
        const pnlPercent = pos.collateral > 0 ? (pnl / pos.collateral) * 100 : 0;
        return { ...pos, markPrice, pnl, pnlPercent };
      });

      setPositions(updated);
      savePositionsSnapshot(updated, address);
    } catch (err) {
      if (isProgramNotAllowedError(err)) {
        setPositions([]);
        if (!permissionToastShownRef.current) {
          permissionToastShownRef.current = true;
          toast.error("Shield blocked private record access for this program. Reconnect wallet and approve program permissions.");
        }
        return;
      }
      console.error("Failed to fetch position records:", err);
    } finally {
      setLoadingRecords(false);
    }
  }, [connected, requestRecords, getPrice, address, connect, disconnect, positionRecordProgramCandidates]);

  useEffect(() => {
    closedPositionIdsRef.current = loadClosedPositionIds(address);
  }, [address]);


  useEffect(() => {
    fetchPositions();
    // Poll every 30s
    const interval = setInterval(fetchPositions, 30000);
    const onChanged = () => fetchPositions();
    window.addEventListener("autoperp:positions-changed", onChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener("autoperp:positions-changed", onChanged);
    };
  }, [fetchPositions]);

  // Keep mark price + PnL live as the price feed updates (without waiting for record re-sync).
  useEffect(() => {
    if (positions.length === 0) return;
    setPositions((prev) =>
      prev.map((pos) => {
        const live = prices.find((p) => p.symbol === pos.market)?.price ?? 0;
        const markPrice = Number.isFinite(live) && live > 0 ? live : pos.markPrice > 0 ? pos.markPrice : pos.entryPrice;
        if (!markPrice || markPrice <= 0) return pos;
        const pnl =
          pos.direction === "long"
            ? pos.size * ((markPrice - pos.entryPrice) / pos.entryPrice)
            : pos.size * ((pos.entryPrice - markPrice) / pos.entryPrice);
        const pnlPercent = pos.collateral > 0 ? (pnl / pos.collateral) * 100 : 0;
        return { ...pos, markPrice, pnl, pnlPercent };
      }),
    );
  }, [prices, positions.length]);

    const markPositionClosedLocally = useCallback((pos: PositionRecord, recordInput?: string | null) => {
      const keys = closedPositionIdsRef.current;
      keys.add(`id:${pos.id}`);
      keys.add(`sig:${pos.signature}`);
      if (pos.recordFp) keys.add(`rec:${pos.recordFp}`);
      if (recordInput) keys.add(`rec:${hashText(recordInput)}`);
      saveClosedPositionIds(keys, address);
      delete closeFailureCountRef.current[pos.signature];

      setPositions((prev) => {
        const next = prev.filter((p) => p.id !== pos.id && p.signature !== pos.signature);
        savePositionsSnapshot(next, address);
        return next;
      });
    }, [address]);

    const handleClose = async (pos: PositionRecord) => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      return;
    }

    if (closingId || txLoading) {
      toast.info("A close transaction is already in progress.");
      return;
    }

    let recordInput = serializePositionRecordInput(pos.rawData);
    const targetRecordFp = recordInput ? hashText(recordInput) : null;
    let publicVaultBefore = 0;
    let privateVaultBeforeMicro = 0;
    const alreadyClosed = closedPositionIdsRef.current;
    if (alreadyClosed.has(`id:${pos.id}`) || alreadyClosed.has(`sig:${pos.signature}`) || (pos.recordFp && alreadyClosed.has(`rec:${pos.recordFp}`))) {
      markPositionClosedLocally(pos, recordInput);
      toast.info("This position record is already marked consumed locally.");
      return;
    }

    const currentAddress = (address ?? "").trim().toLowerCase();

    const loadPrivateVaultState = async () => {
      if (!address) return null;
      try {
        const records = await requestProgramRecords(
          requestRecords,
          coreProgram,
          true,
          disconnect,
          connect,
        );
        const vault = findVaultRecord(records, address);
        if (!vault) return null;
        return {
          input: vault.input,
          balanceMicro: vault.balanceMicro,
        };
      } catch {
        return null;
      }
    };

    if (!isPrivateMode && address) {
      publicVaultBefore = await fetchPublicVaultUsdcx(coreProgram, address);
    } else if (isPrivateMode) {
      const privateBefore = await loadPrivateVaultState();
      privateVaultBeforeMicro = privateBefore?.balanceMicro ?? 0;
    }

    const resolveFreshRecordInput = async (): Promise<string | null> => {
      try {
        const latest = await requestProgramRecordsAny(
          requestRecords,
          positionRecordProgramCandidates,
          true,
          disconnect,
          connect,
        );
        const latestParsed = latest
          .filter((r) => !isRecordSpent(r))
          .filter(isLikelyPositionRecord)
          .map((r) => parseAleoPositionRecord(r, MARKET_NAMES))
          .filter((p): p is NonNullable<ReturnType<typeof parseAleoPositionRecord>> => p !== null);

        const candidates = latestParsed
          .map((p) => ({
            parsed: p,
            input: serializePositionRecordInput(p.rawData),
          }))
          .filter((x): x is { parsed: NonNullable<ReturnType<typeof parseAleoPositionRecord>>; input: string } => Boolean(x.input));

        const byExactRecord = targetRecordFp
          ? candidates.find((c) => hashText(c.input) === targetRecordFp)
          : undefined;

        const byInstanceId = candidates.find((c) => c.parsed.id === pos.id);
        const bySignature = candidates.find((c) =>
          c.parsed.positionId === pos.positionId &&
          c.parsed.market === pos.market &&
          c.parsed.direction === pos.direction &&
          c.parsed.leverage === pos.leverage &&
          Math.abs(c.parsed.collateral - pos.collateral) <= 0.000001 &&
          Math.abs(c.parsed.entryPrice - pos.entryPrice) <= Math.max(0.01, pos.entryPrice * 0.0001),
        );

        // Public-mode close should avoid fuzzy signature-only fallback to reduce stale-input rejects.
        const match = !isPrivateMode
          ? (byExactRecord ?? byInstanceId)
          : (byExactRecord ?? byInstanceId ?? bySignature);

        if (!match?.parsed?.rawData || !match.input) return null;

        const owner = getPositionRecordOwner(match.parsed.rawData)?.toLowerCase() ?? "";
        if (currentAddress && owner && owner !== currentAddress) {
          toast.error("Position owner mismatch. Refresh records and reconnect the owner wallet.");
          return null;
        }

        return match.input;
      } catch {
        return null;
      }
    };

    const firstFresh = await resolveFreshRecordInput();
    if (firstFresh) recordInput = firstFresh;

    if (!recordInput) {
      toast.error("Could not prepare a valid spendable position record. Refresh and try again.");
      return;
    }

    if (!isPrivateMode && currentAddress) {
      const inputOwner = ownerFromRecordInput(recordInput);
      if (!inputOwner || inputOwner !== currentAddress) {
        toast.error("Position owner mismatch or stale record detected. Refresh positions and retry close.");
        return;
      }
    }

    setClosingId(pos.id);
    const livePrice = getPrice(pos.market)?.price ?? 0;
    const fallbackMark = Number.isFinite(pos.markPrice) ? pos.markPrice : 0;
    const fallbackEntry = Number.isFinite(pos.entryPrice) ? pos.entryPrice : 0;
    const currentPrice =
      (Number.isFinite(livePrice) && livePrice > 0 ? livePrice : 0) ||
      (fallbackMark > 0 ? fallbackMark : 0) ||
      (fallbackEntry > 0 ? fallbackEntry : 0);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      toast.error("Current mark price unavailable. Try again in a moment.");
      setClosingId(null);
      return;
    }

    if (!(Number.isFinite(livePrice) && livePrice > 0) && currentPrice === fallbackEntry) {
      toast.info("Live price feed is temporarily unavailable; using entry price fallback for close.");
    }

    let executedClosePrice = currentPrice;

    const isUnknownCloseReject = (detail: string): boolean => {
      const lower = detail.toLowerCase();
      return lower.includes("unknown reason") || lower.includes("close transaction rejected");
    };

    const isAlreadyConsumedError = (detail: string): boolean =>
      /already exists in the ledger|input id|already consumed/i.test(detail);

    const handleConsumedAndExitIfNeeded = (): boolean => {
      const latestErr = (getLastError() ?? "").trim();
      if (!latestErr) return false;
      if (!isAlreadyConsumedError(latestErr)) return false;

      markPositionClosedLocally(pos, recordInput);
      toast.success("Position record already consumed. Removed from open positions.");
      setClosingId(null);
      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 800);
      return true;
    };

    const runClose = async (price: number, fee: number) => {
      const fresh = await resolveFreshRecordInput();
      if (fresh) {
        recordInput = fresh;
      } else if (!isPrivateMode) {
        // Public close should not proceed with a potentially stale cached record.
        return null;
      }

      if (isPrivateMode) {
        const poolId = MARKET_IDS[pos.market];
        if (!poolId) return null;

        let latest: unknown[] = [];
        try {
          latest = await requestProgramRecords(
            requestRecords,
            coreProgram,
            true,
            disconnect,
            connect,
          );
        } catch {
          latest = [];
        }

        const owner = (address ?? "").trim();
        const vault = findVaultRecord(latest, owner);
        const pool = findPoolStateRecord(latest, owner, poolId);

        if (!vault || !pool) {
          toast.error("Could not load private vault/pool records required to close this position.");
          return null;
        }

        return execute(coreProgram, "close_position", [
          recordInput,
          vault.input,
          pool.input,
          toPrice(price),
        ], fee);
      }

      if (!isPrivateMode && currentAddress) {
        const inputOwner = ownerFromRecordInput(recordInput);
        if (!inputOwner || inputOwner !== currentAddress) {
          return null;
        }
      }

      return execute(coreProgram, "close_position", [
        recordInput,
        toPrice(price),
      ], fee);
    };

    let result = await runClose(currentPrice, 2_000_000);

    if (!result && handleConsumedAndExitIfNeeded()) {
      return;
    }

    if (!result) {
      // Retry once with a higher fee to reduce occasional wallet/prover rejection.
      result = await runClose(currentPrice, 5_000_000);
      if (!result && handleConsumedAndExitIfNeeded()) {
        return;
      }
    }

    if (!result) {
      const detail = (getLastError() ?? "").trim().toLowerCase();
      const isSubtractUnderflow = detail.includes("integer subtraction failed");
      const canFallbackAtEntry = pos.entryPrice > 0 && Math.abs(pos.entryPrice - currentPrice) > 0.0000001;

      if (isSubtractUnderflow && canFallbackAtEntry) {
        toast.info("Close fallback activated: retrying with entry price due on-chain subtraction bug.");
        result = await runClose(pos.entryPrice, 5_000_000);
        if (!result && handleConsumedAndExitIfNeeded()) {
          return;
        }
        if (result) {
          executedClosePrice = pos.entryPrice;
          toast.success("Position closed using safety fallback price. PnL may differ from live mark for this close.");
        }
      }
    }

    if (!result && !isPrivateMode) {
      const detail = (getLastError() ?? "").trim();
      if (isUnknownCloseReject(detail)) {
        toast.info("Close retry in progress: refreshing latest record state...");

        for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
          await fetchPositions();
          await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 1000));

          const refreshedLive = getPrice(pos.market)?.price ?? 0;
          const retryPrice = Number.isFinite(refreshedLive) && refreshedLive > 0 ? refreshedLive : currentPrice;
          const retryFee = 6_000_000 + attempt * 1_000_000;

          result = await runClose(retryPrice, retryFee);
          if (!result && handleConsumedAndExitIfNeeded()) {
            return;
          }

          if (result) {
            executedClosePrice = retryPrice;
            break;
          }
        }
      }
    }

    if (!result) {
      const detail = (getLastError() ?? "").trim();
      const lower = detail.toLowerCase();
      const alreadyConsumed = isAlreadyConsumedError(lower);
      if (alreadyConsumed) {
        markPositionClosedLocally(pos, recordInput);
        toast.success("Position record already consumed. Removed from open positions.");
        setClosingId(null);
        setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 1000);
        return;
      }

      await fetchPositions();
      const latestInput = await resolveFreshRecordInput();
      const stillExists = Boolean(latestInput);
      if (!stillExists) {
        toast.success("Position appears closed/finalizing on-chain. Refreshing list.");
      } else if (detail) {
        toast.error(`Close failed: ${detail}`);
      }
    }

    if (result) {
      markPositionClosedLocally(pos, recordInput);

      if (!isPrivateMode && address) {
        let publicVaultAfter = publicVaultBefore;
        for (let i = 0; i < 8; i += 1) {
          const next = await fetchPublicVaultUsdcx(coreProgram, address);
          if (next > publicVaultAfter) {
            publicVaultAfter = next;
            break;
          }
          publicVaultAfter = next;
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }

        const credit = Math.max(0, publicVaultAfter - publicVaultBefore);
        if (credit > 0.000001) {
          toast.info(`Withdrawing ${credit.toFixed(6)} USDCx to wallet...`);
          const withdrawResult = await execute(coreProgram, "withdraw_collateral", [toUsdcx(credit)], 500_000);
          if (withdrawResult) {
            toast.success(`Closed position payout sent to wallet: ${credit.toFixed(6)} USDCx`);
          } else {
            const wdErr = (getLastError() ?? "Unknown error").trim();
            toast.warning(`Close succeeded, but auto-withdraw failed: ${wdErr}`);
          }
        }
      }

      if (isPrivateMode) {
        let privateAfter = await loadPrivateVaultState();
        for (let i = 0; i < 10; i += 1) {
          if (privateAfter && privateAfter.balanceMicro > privateVaultBeforeMicro) break;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          privateAfter = await loadPrivateVaultState();
        }

        const afterMicro = privateAfter?.balanceMicro ?? privateVaultBeforeMicro;
        const creditMicro = Math.max(0, afterMicro - privateVaultBeforeMicro);
        if (creditMicro > 0 && privateAfter?.input) {
          const creditUsdcx = creditMicro / 1_000_000;
          toast.info(`Withdrawing ${creditUsdcx.toFixed(6)} USDCx to wallet...`);
          const withdrawResult = await execute(
            coreProgram,
            "withdraw_collateral",
            [privateAfter.input, `${creditMicro}u64`],
            1_000_000,
          );
          if (withdrawResult) {
            toast.success(`Closed position payout sent to wallet: ${creditUsdcx.toFixed(6)} USDCx`);
          } else {
            const wdErr = (getLastError() ?? "Unknown error").trim();
            toast.warning(`Close succeeded, but private auto-withdraw failed: ${wdErr}`);
          }
        }
      }

      const notional = pos.size;
      const pnl =
        pos.direction === "long"
          ? notional * ((executedClosePrice - pos.entryPrice) / pos.entryPrice)
          : notional * ((pos.entryPrice - executedClosePrice) / pos.entryPrice);
      addTradeEvent({
        id: newId("trade"),
        type: "CLOSE",
        market: pos.market,
        side: pos.direction,
        collateralUsdcx: pos.collateral,
        leverage: pos.leverage,
        entryPrice: pos.entryPrice,
        exitPrice: executedClosePrice,
        pnlUsd: pnl,
        txId: result.transactionId,
        ts: Date.now(),
      }, address);
      setPositions((prev) => {
        const next = prev.filter((p) => p.id !== pos.id && p.signature !== pos.signature);
        savePositionsSnapshot(next, address);
        return next;
      });
      // Force a refresh so Shield record sync/decryption updates the table quickly.
      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 1500);
      closeFailureCountRef.current[pos.signature] = 0;
    }

    if (!result) {
      const key = pos.signature;
      const nextCount = (closeFailureCountRef.current[key] ?? 0) + 1;
      closeFailureCountRef.current[key] = nextCount;

      const detail = (getLastError() ?? "").trim();

      if (isUnknownCloseReject(detail) && nextCount >= 2) {
        const latestInput = await resolveFreshRecordInput();
        const stillExists = Boolean(latestInput);
        if (!stillExists) {
          markPositionClosedLocally(pos, recordInput);
          toast.warning("Position record no longer spendable. Hiding stale row.");
          setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 800);
        }
      }
    }
    setClosingId(null);
  };

  return (
    <div className="border-t border-border h-[300px] flex flex-col overflow-hidden">
      <div className="flex items-center gap-0 border-b border-border">
        {(["positions", "orders", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-xs capitalize transition-colors border-b-2",
              tab === t
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {t}
            {t === "positions" && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                ({loadingRecords ? "..." : positions.length})
              </span>
            )}
          </button>
        ))}
        {connected && (
          <button
            onClick={fetchPositions}
            disabled={loadingRecords}
            className="ml-auto mr-4 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            {loadingRecords ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </button>
        )}
      </div>

      {tab === "positions" && (
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          {positions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-xs text-muted-foreground">
                {connected
                  ? loadingRecords
                    ? "Loading positions from chain..."
                    : "No open positions"
                  : "Connect wallet to view positions"}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5 font-medium">Market</th>
                    <th className="text-left px-4 py-2.5 font-medium">Size</th>
                    <th className="text-left px-4 py-2.5 font-medium">Leverage</th>
                    <th className="text-left px-4 py-2.5 font-medium">Entry</th>
                    <th className="text-left px-4 py-2.5 font-medium">Mark</th>
                    <th className="text-left px-4 py-2.5 font-medium">PnL</th>
                    <th className="text-left px-4 py-2.5 font-medium">Agent</th>
                    <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <tr key={pos.id} className="border-t border-border hover:bg-card/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isPrivateMode && <Lock className="h-3 w-3 text-muted-foreground" />}
                          <span className="text-xs font-medium text-foreground">{pos.market}</span>
                          <span
                            className={cn(
                              "text-[10px] font-medium uppercase",
                              pos.direction === "long" ? "text-success" : "text-destructive"
                            )}
                          >
                            {pos.direction}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground">
                        ${pos.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground">{pos.leverage}x</td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground">
                        ${pos.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-foreground">
                        ${pos.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "text-xs font-mono",
                            pos.pnl >= 0 ? "text-success" : "text-destructive"
                          )}
                        >
                          {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pos.agentActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                            <Bot className="h-3 w-3" />
                            Active
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Off</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleClose(pos)}
                          disabled={closingId === pos.id || txLoading}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          {closingId === pos.id ? "Closing..." : "Close"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-border">
                {positions.map((pos) => (
                  <div key={pos.id} className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isPrivateMode && <Lock className="h-3 w-3 text-muted-foreground" />}
                        <span className="text-sm font-medium text-foreground">{pos.market}</span>
                        <span
                          className={cn(
                            "text-[10px] font-medium uppercase px-1.5 py-0.5 rounded",
                            pos.direction === "long"
                              ? "text-success bg-success/10"
                              : "text-destructive bg-destructive/10"
                          )}
                        >
                          {pos.direction} {pos.leverage}x
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-mono font-medium",
                          pos.pnl >= 0 ? "text-success" : "text-destructive"
                        )}
                      >
                        {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Size</p>
                        <p className="text-xs font-mono text-foreground">
                          ${pos.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Entry</p>
                        <p className="text-xs font-mono text-foreground">
                          ${pos.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Mark</p>
                        <p className="text-xs font-mono text-foreground">
                          ${pos.markPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      {pos.agentActive ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-primary">
                          <Bot className="h-3 w-3" />
                          Agent: SL ${pos.stopLoss.toLocaleString()} / TP ${pos.takeProfit.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Agent disabled</span>
                      )}
                      <button
                        onClick={() => handleClose(pos)}
                        disabled={closingId === pos.id || txLoading}
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {closingId === pos.id ? "Closing..." : "Close"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab !== "positions" && (
        <div className="flex-1 p-8 text-center">
          <p className="text-xs text-muted-foreground">No {tab} yet</p>
        </div>
      )}
    </div>
  );
};

export default PositionsList;





