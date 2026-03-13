import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { Lock, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import {
  useAleoTransaction,
  PROGRAMS,
  toPrice,
} from "@/hooks/useAleoTransaction";
import usePrices from "@/hooks/usePrices";
import { LEGACY_SETTLEMENT_MESSAGE, REAL_SETTLEMENT_AVAILABLE } from "@/lib/protocol";
import { STRICT_PRIVATE_CORE_ACTIVE } from "@/lib/protocol";
import { addTradeEvent, newId } from "@/lib/portfolioStore";
import {
  getPositionRecordOwner,
  isLikelyPositionRecord,
  parseAleoPositionRecord,
  serializePositionRecordInput,
} from "@/lib/positionRecord";
import { findPoolStateRecord, findVaultRecord } from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords } from "@/lib/walletRecords";

const POSITIONS_SNAPSHOT_KEY = "autoperp:positions:snapshot";

function snapshotKey(address?: string | null): string {
  const scope = (address ?? "").trim().toLowerCase() || "guest";
  return `${POSITIONS_SNAPSHOT_KEY}:${scope}`;
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

const PositionsList = () => {
  const [tab, setTab] = useState<"positions" | "orders" | "history">("positions");
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const permissionToastShownRef = useRef(false);
  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { execute, loading: txLoading, getLastError } = useAleoTransaction();
  const { prices, getPrice } = usePrices();

  const fetchPositions = useCallback(async () => {
    if (!connected) {
      setPositions([]);
      return;
    }
    setLoadingRecords(true);
    try {
      const allRecords = await requestProgramRecords(
        requestRecords,
        PROGRAMS.CORE,
        true,
        disconnect,
        connect,
      );
      const parsed = allRecords
        .filter(isLikelyPositionRecord)
        .map((r) => parseAleoPositionRecord(r, MARKET_NAMES))
        .filter((p): p is NonNullable<ReturnType<typeof parseAleoPositionRecord>> => p !== null)
        .map((p) => ({
          id: p.id,
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
        }));

      // Update mark prices and PnL
      const updated = parsed.map((pos) => {
        const livePrice = getPrice(pos.market)?.price ?? pos.entryPrice;
        const markPrice = livePrice;
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
  }, [connected, requestRecords, getPrice, address]);


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
        if (!live || live <= 0) return pos;
        const markPrice = live;
        const pnl =
          pos.direction === "long"
            ? pos.size * ((markPrice - pos.entryPrice) / pos.entryPrice)
            : pos.size * ((pos.entryPrice - markPrice) / pos.entryPrice);
        const pnlPercent = pos.collateral > 0 ? (pnl / pos.collateral) * 100 : 0;
        return { ...pos, markPrice, pnl, pnlPercent };
      }),
    );
  }, [prices, positions.length]);

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
    const currentAddress = (address ?? "").trim().toLowerCase();

    try {
      const latest = await requestProgramRecords(
        requestRecords,
        PROGRAMS.CORE,
        true,
        disconnect,
        connect,
      );
      const latestParsed = latest
        .filter(isLikelyPositionRecord)
        .map((r) => parseAleoPositionRecord(r, MARKET_NAMES))
        .filter((p): p is NonNullable<ReturnType<typeof parseAleoPositionRecord>> => p !== null);
      const match =
        latestParsed.find((p) => p.id === pos.id) ??
        latestParsed.find(
          (p) =>
            p.market === pos.market &&
            p.direction === pos.direction &&
            Math.abs(p.entryPrice - pos.entryPrice) <= Math.max(1, pos.entryPrice * 0.001),
        );
      if (match?.rawData) {
        const owner = getPositionRecordOwner(match.rawData)?.toLowerCase() ?? "";
        if (currentAddress && owner && owner !== currentAddress) {
          toast.error("Position owner mismatch. Refresh records and reconnect the owner wallet.");
          return;
        }
        const freshRecord = serializePositionRecordInput(match.rawData);
        if (freshRecord) recordInput = freshRecord;
      }
    } catch {
      // fall back to current row record payload
    }

    if (!recordInput) {
      toast.error("Could not prepare a valid spendable position record. Refresh and try again.");
      return;
    }

    setClosingId(pos.id);
    const currentPrice = getPrice(pos.market)?.price ?? pos.markPrice;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      toast.error("Current mark price unavailable. Try again in a moment.");
      setClosingId(null);
      return;
    }

    let result = null;

    if (STRICT_PRIVATE_CORE_ACTIVE) {
      const poolId = MARKET_IDS[pos.market];
      if (!poolId) {
        toast.error("Unsupported market for private close.");
        setClosingId(null);
        return;
      }

      let latest: unknown[] = [];
      try {
        latest = await requestProgramRecords(
          requestRecords,
          PROGRAMS.CORE,
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
        setClosingId(null);
        return;
      }

      result = await execute(PROGRAMS.CORE, "close_position", [
        recordInput,
        vault.input,
        pool.input,
        toPrice(currentPrice),
      ], 2_000_000);
    } else {
      result = await execute(PROGRAMS.CORE, "close_position", [
        recordInput,
        toPrice(currentPrice),
      ], 2_000_000);
    }

    if (!result) {
      // Retry once with a higher fee to reduce occasional wallet/prover rejection.
      if (STRICT_PRIVATE_CORE_ACTIVE) {
        let latest: unknown[] = [];
        try {
          latest = await requestProgramRecords(
            requestRecords,
            PROGRAMS.CORE,
            true,
            disconnect,
            connect,
          );
        } catch {
          latest = [];
        }
        const owner = (address ?? "").trim();
        const poolId = MARKET_IDS[pos.market];
        const vault = findVaultRecord(latest, owner);
        const pool = poolId ? findPoolStateRecord(latest, owner, poolId) : null;
        if (vault && pool) {
          result = await execute(PROGRAMS.CORE, "close_position", [
            recordInput,
            vault.input,
            pool.input,
            toPrice(currentPrice),
          ], 5_000_000);
        }
      } else {
        result = await execute(PROGRAMS.CORE, "close_position", [
          recordInput,
          toPrice(currentPrice),
        ], 5_000_000);
      }
    }

    if (!result) {
      const detail = (getLastError() ?? "").trim();
      if (detail) {
        toast.error(`Close failed: ${detail}`);
      }
    }

    if (result) {
      const notional = pos.size;
      const pnl =
        pos.direction === "long"
          ? notional * ((currentPrice - pos.entryPrice) / pos.entryPrice)
          : notional * ((pos.entryPrice - currentPrice) / pos.entryPrice);
      addTradeEvent({
        id: newId("trade"),
        type: "CLOSE",
        market: pos.market,
        side: pos.direction,
        collateralUsdcx: pos.collateral,
        leverage: pos.leverage,
        entryPrice: pos.entryPrice,
        exitPrice: currentPrice,
        pnlUsd: pnl,
        txId: result.transactionId,
        ts: Date.now(),
      }, address);
      setPositions((prev) => {
        const next = prev.filter((p) => p.id !== pos.id);
        savePositionsSnapshot(next, address);
        return next;
      });
      // Force a refresh so Shield record sync/decryption updates the table quickly.
      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 1500);
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
                          <Lock className="h-3 w-3 text-muted-foreground" />
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
                        <Lock className="h-3 w-3 text-muted-foreground" />
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





