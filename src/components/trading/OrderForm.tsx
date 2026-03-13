import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import usePrices, { formatPrice } from "@/hooks/usePrices";
import useUsdcxBalance from "@/hooks/useUsdcxBalance";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { useAleoTransaction, PROGRAMS, MARKET_IDS, toUsdcx, toPrice } from "@/hooks/useAleoTransaction";
import { addOrder, addTradeEvent, newId } from "@/lib/portfolioStore";
import {
  LEGACY_SETTLEMENT_MESSAGE,
  REAL_SETTLEMENT_AVAILABLE,
  STRICT_PRIVATE_CORE_ACTIVE,
} from "@/lib/protocol";
import {
  findPoolStateRecord,
  findVaultRecord,
} from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords } from "@/lib/walletRecords";
import { toast } from "sonner";

interface OrderFormProps {
  market: string;
}

const OrderForm = ({ market }: OrderFormProps) => {
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [limitPriceInput, setLimitPriceInput] = useState("");
  const [slPriceInput, setSlPriceInput] = useState("");
  const [tpPriceInput, setTpPriceInput] = useState("");
  const [slPctInput, setSlPctInput] = useState("");
  const [tpPctInput, setTpPctInput] = useState("");

  const { getPrice } = usePrices();
  const {
    usdcxBalance,
    loading: balanceLoading,
    refetch: refetchBalance,
  } = useUsdcxBalance();
  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { execute, loading: txLoading } = useAleoTransaction();

  const currentPrice = getPrice(market)?.price ?? 0;
  const leverageOptions = [1, 2, 5, 10, 25, 50];

  const sanitizeUsdcxInput = (raw: string): string => {
    // Allow only digits and a single dot. Clamp to 6 decimals (USDCx has 6 decimals).
    const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const [whole, ...rest] = cleaned.split(".");
    const frac = rest.join("").slice(0, 6);
    return rest.length ? `${whole}.${frac}` : whole;
  };

  const parseNum = (s: string): number | null => {
    const cleaned = s.replace(/,/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const basePrice = (() => {
    if (orderType === "limit") {
      const px = parseNum(limitPriceInput);
      return px && px > 0 ? px : currentPrice;
    }
    return currentPrice;
  })();

  const formatPct = (n: number) => {
    if (!Number.isFinite(n)) return "";
    if (n === 0) return "0";
    return n.toFixed(n < 1 ? 2 : 1);
  };

  const pctToPrice = (pct: number, kind: "sl" | "tp"): number | null => {
    if (pct <= 0 || basePrice <= 0) return null;
    const p = pct / 100;
    if (kind === "sl") {
      const px = direction === "long" ? basePrice * (1 - p) : basePrice * (1 + p);
      return px > 0 ? px : null;
    }
    const px = direction === "long" ? basePrice * (1 + p) : basePrice * (1 - p);
    return px > 0 ? px : null;
  };

  const priceToPct = (price: number, kind: "sl" | "tp"): number | null => {
    if (price <= 0 || basePrice <= 0) return null;
    if (kind === "sl") {
      const pct = direction === "long"
        ? ((basePrice - price) / basePrice) * 100
        : ((price - basePrice) / basePrice) * 100;
      return pct > 0 ? pct : null;
    }
    const pct = direction === "long"
      ? ((price - basePrice) / basePrice) * 100
      : ((basePrice - price) / basePrice) * 100;
    return pct > 0 ? pct : null;
  };

  const slPrice = (() => {
    const px = parseNum(slPriceInput);
    if (px && px > 0) return px;
    const pct = parseNum(slPctInput);
    return pct ? pctToPrice(pct, "sl") : null;
  })();

  const tpPrice = (() => {
    const px = parseNum(tpPriceInput);
    if (px && px > 0) return px;
    const pct = parseNum(tpPctInput);
    return pct ? pctToPrice(pct, "tp") : null;
  })();

  const entryPrice = basePrice;

  useEffect(() => {
    if (orderType === "limit" && !limitPriceInput && currentPrice > 0) {
      setLimitPriceInput(formatPrice(currentPrice));
    }
  }, [orderType, limitPriceInput, currentPrice]);

  useEffect(() => {
    const onPick = (e: Event) => {
      const ce = e as CustomEvent<{ price?: number }>;
      const price = ce?.detail?.price;
      if (!price || !Number.isFinite(price)) return;
      setOrderType("limit");
      setLimitPriceInput(formatPrice(price));
    };
    window.addEventListener("autoperp:orderbook-price", onPick as EventListener);
    return () => window.removeEventListener("autoperp:orderbook-price", onPick as EventListener);
  }, []);

  const handleMax = () => {
    if (usdcxBalance && parseFloat(usdcxBalance) > 0) {
      setSize(parseFloat(usdcxBalance).toFixed(2));
    }
  };

  const handleSaveLimitOrder = () => {
    if (!connected || !address) {
      toast.error("Connect your Shield wallet first.");
      return;
    }

    const collateral = parseFloat(size);
    if (!collateral || collateral <= 0) {
      toast.error("Enter a valid collateral amount.");
      return;
    }

    const lp = parseNum(limitPriceInput);
    if (!lp || lp <= 0) {
      toast.error("Enter a valid limit price.");
      return;
    }

    addOrder({
      id: newId("order"),
      market,
      side: direction,
      kind: "limit",
      collateralUsdcx: collateral,
      leverage,
      limitPrice: lp,
      stopLoss: slPrice ?? undefined,
      takeProfit: tpPrice ?? undefined,
      createdAt: Date.now(),
      status: "open",
    }, address);

    toast.success("Saved as open order.");
  };

  const handleSubmit = async () => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      return;
    }

    if (!connected || !address) {
      toast.error("Connect your Shield wallet first.");
      return;
    }

    const collateral = parseFloat(size);
    if (!collateral || collateral <= 0) {
      toast.error("Enter a valid collateral amount.");
      return;
    }

    if (!STRICT_PRIVATE_CORE_ACTIVE && usdcxBalance && collateral > parseFloat(usdcxBalance)) {
      toast.error("Insufficient USDCx balance.");
      return;
    }

    const marketId = MARKET_IDS[market];
    if (!marketId) {
      toast.error(`Market ${market} is not supported on-chain.`);
      return;
    }

    if (orderType === "limit") {
      const lp = parseNum(limitPriceInput);
      if (!lp || lp <= 0) {
        toast.error("Enter a valid limit price.");
        return;
      }
    }

    if (entryPrice > 0) {
      if (slPrice !== null) {
        const ok = direction === "long" ? slPrice < entryPrice : slPrice > entryPrice;
        if (!ok) {
          toast.error("Stop Loss must be on the correct side of entry price.");
          return;
        }
      }
      if (tpPrice !== null) {
        const ok = direction === "long" ? tpPrice > entryPrice : tpPrice < entryPrice;
        if (!ok) {
          toast.error("Take Profit must be on the correct side of entry price.");
          return;
        }
      }
    }

    const directionVal = direction === "long" ? "0u8" : "1u8";
    const sl = slPrice ? toPrice(slPrice) : "0u64";
    const tp = tpPrice ? toPrice(tpPrice) : "0u64";
    const paramsInput = `{ market_id: ${marketId}, direction: ${directionVal}, collateral: ${toUsdcx(collateral)}, leverage: ${leverage}u64, entry_price: ${toPrice(entryPrice)}, stop_loss: ${sl}, take_profit: ${tp} }`;

    let result = null;

    if (STRICT_PRIVATE_CORE_ACTIVE) {
      const poolId = marketId;
      const owner = address;

      const loadState = async () => {
        const records = await requestProgramRecords(
          requestRecords,
          PROGRAMS.CORE,
          true,
          disconnect,
          connect,
        );
        const vault = findVaultRecord(records, owner);
        const pool = findPoolStateRecord(records, owner, poolId);
        return { records, vault, pool };
      };

      let vault: ReturnType<typeof findVaultRecord>;
      let pool: ReturnType<typeof findPoolStateRecord>;
      try {
        ({ vault, pool } = await loadState());
      } catch (error) {
        if (isProgramNotAllowedError(error)) {
          toast.error("Shield denied record access for this program. Reconnect wallet and approve permissions.");
          return;
        }
        toast.error("Could not load private records from Shield.");
        return;
      }

      if (!vault) {
        const created = await execute(PROGRAMS.CORE, "create_vault", ["0u64"], 500_000);
        if (!created) {
          toast.error("Could not initialize private vault record.");
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!pool) {
        const bootstrapped = await execute(PROGRAMS.CORE, "bootstrap_pool", [poolId, "0u64"], 500_000);
        if (!bootstrapped) {
          toast.error("Could not initialize private pool state record.");
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!vault || !pool) {
        toast.error("Could not load private state records for trading.");
        return;
      }

      const collateralMicro = Math.floor(collateral * 1_000_000);
      const neededTopUp = Math.max(0, collateralMicro - vault.balanceMicro);

      if (neededTopUp > 0) {
        toast.info(`Step 1/2: Funding private vault by ${(neededTopUp / 1_000_000).toFixed(6)} units...`);
        const funded = await execute(
          PROGRAMS.CORE,
          "deposit_collateral",
          [vault.input, `${neededTopUp}u64`],
          500_000,
        );
        if (!funded) {
          toast.error("Private vault funding failed.");
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!vault || !pool) {
        toast.error("Private state refresh failed after funding.");
        return;
      }

      toast.info("Step 2/2: Opening private position - approve in Shield...");
      result = await execute(
        PROGRAMS.CORE,
        "open_position",
        [vault.input, pool.input, paramsInput, address],
        1_000_000,
      );
    } else {
      toast.info(`Step 1/2: Locking ${collateral} USDCx as collateral - approve in Shield...`);

      const depositResult = await execute(
        PROGRAMS.CORE,
        "deposit_collateral",
        [toUsdcx(collateral)],
        500_000,
      );

      if (!depositResult) {
        toast.error("Deposit cancelled. Position not opened.");
        return;
      }

      setTimeout(() => refetchBalance(), 2500);
      toast.info("Step 2/2: Opening position - approve in Shield...");
      result = await execute(PROGRAMS.CORE, "open_position", [paramsInput, address], 1_000_000);
    }

    if (result) {
      setSize("");
      setSlPriceInput("");
      setTpPriceInput("");
      setSlPctInput("");
      setTpPctInput("");
      setLimitPriceInput("");
      setTimeout(() => refetchBalance(), 3000);
      setTimeout(() => refetchBalance(), 8000);
      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 2500);

      // Add to order history and trade history (Portfolio page).
      addOrder({
        id: newId("order"),
        market,
        side: direction,
        kind: orderType,
        collateralUsdcx: collateral,
        leverage,
        limitPrice: orderType === "limit" ? entryPrice : undefined,
        stopLoss: slPrice ?? undefined,
        takeProfit: tpPrice ?? undefined,
        createdAt: Date.now(),
        status: "executed",
        executedTxId: result.transactionId,
      }, address);

      addTradeEvent({
        id: newId("trade"),
        type: "OPEN",
        market,
        side: direction,
        collateralUsdcx: collateral,
        leverage,
        entryPrice,
        txId: result.transactionId,
        ts: Date.now(),
      }, address);
    }
  };

  const liquidationPrice = (() => {
    if (!size || leverage <= 1 || entryPrice <= 0) return "--";
    const factor = 0.9 / leverage;
    const value = direction === "long" ? entryPrice * (1 - factor) : entryPrice * (1 + factor);
    return `$${formatPrice(value)}`;
  })();

  return (
    <div className="p-4 h-full">
      {!REAL_SETTLEMENT_AVAILABLE && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {LEGACY_SETTLEMENT_MESSAGE}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-secondary mb-4">
        <button
          onClick={() => setDirection("long")}
          className={cn(
            "py-2 text-xs font-medium rounded-md transition-all",
            direction === "long"
              ? "bg-success text-success-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Long
        </button>
        <button
          onClick={() => setDirection("short")}
          className={cn(
            "py-2 text-xs font-medium rounded-md transition-all",
            direction === "short"
              ? "bg-destructive text-destructive-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Short
        </button>
      </div>

      <div className="flex gap-4 mb-4">
        {(["market", "limit"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={cn(
              "text-xs capitalize transition-colors",
              orderType === type ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {orderType === "limit" && (
        <div className="mb-4">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">
            Limit Price (USD)
          </label>
          <input
            type="text"
            value={limitPriceInput}
            onChange={(e) => setLimitPriceInput(e.target.value)}
            placeholder={currentPrice > 0 ? `${formatPrice(currentPrice)}` : "0.00"}
            className="w-full h-9 px-3 text-xs font-mono bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={handleSaveLimitOrder}
            className="mt-2 text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            Save as open order
          </button>
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Size (USDCx)
          </label>
          {connected && (
            <span className="text-[10px] text-muted-foreground">
              Available: <span className="font-mono text-foreground">{balanceLoading ? "..." : usdcxBalance ?? "0.00"} USDCx</span>
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type="text"
            value={size}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              const next = sanitizeUsdcxInput(e.target.value);
              setSize(next);
            }}
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

      <div className="mb-4">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 block">
          Leverage: {leverage}x
        </label>
        <div className="grid grid-cols-6 gap-1">
          {leverageOptions.map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={cn(
                "py-1.5 text-[10px] font-mono rounded-md transition-colors",
                leverage === lev
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 p-3 rounded-lg border border-border bg-card space-y-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Take Profit / Stop Loss</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">TP Price</label>
              <input
                type="text"
                value={tpPriceInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setTpPriceInput(v);
                  const px = parseNum(v);
                  const pct = px ? priceToPct(px, "tp") : null;
                  setTpPctInput(pct ? formatPct(pct) : "");
                }}
                placeholder="Price"
                className="w-full h-8 px-2.5 text-xs font-mono bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Gain</label>
              <div className="relative">
                <input
                  type="text"
                  value={tpPctInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTpPctInput(v);
                    const pct = parseNum(v);
                    const px = pct ? pctToPrice(pct, "tp") : null;
                    setTpPriceInput(px ? formatPrice(px) : "");
                  }}
                  placeholder="%"
                  className="w-full h-8 pr-8 pl-2.5 text-xs font-mono bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <button
              type="button"
              onClick={() => {
                setTpPriceInput("");
                setTpPctInput("");
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
            <span className="font-mono text-muted-foreground">
              {tpPrice ? `$${formatPrice(tpPrice)}` : "--"}
            </span>
          </div>
        </div>
        <div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">SL Price</label>
              <input
                type="text"
                value={slPriceInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setSlPriceInput(v);
                  const px = parseNum(v);
                  const pct = px ? priceToPct(px, "sl") : null;
                  setSlPctInput(pct ? formatPct(pct) : "");
                }}
                placeholder="Price"
                className="w-full h-8 px-2.5 text-xs font-mono bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Loss</label>
              <div className="relative">
                <input
                  type="text"
                  value={slPctInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSlPctInput(v);
                    const pct = parseNum(v);
                    const px = pct ? pctToPrice(pct, "sl") : null;
                    setSlPriceInput(px ? formatPrice(px) : "");
                  }}
                  placeholder="%"
                  className="w-full h-8 pr-8 pl-2.5 text-xs font-mono bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  %
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <button
              type="button"
              onClick={() => {
                setSlPriceInput("");
                setSlPctInput("");
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
            <span className="font-mono text-muted-foreground">
              {slPrice ? `$${formatPrice(slPrice)}` : "--"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5 mb-4 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry Price</span>
          <span className="font-mono text-foreground">
            {entryPrice > 0 ? `$${formatPrice(entryPrice)}` : "--"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Liquidation Price</span>
          <span className="font-mono text-foreground">{liquidationPrice}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Fee (0.06%)</span>
          <span className="font-mono text-foreground">
            {size ? `$${(parseFloat(size || "0") * 0.0006).toFixed(2)}` : "--"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Privacy</span>
          <span className="text-success text-[10px]">Private position record</span>
        </div>
      </div>

      {(() => {
        const amt = parseFloat(size);
        const bal = parseFloat(usdcxBalance ?? "0");
        const insufficient = amt > 0 && amt > bal;
        const tooSmall = amt > 0 && amt < 1;
        const disabled =
          txLoading ||
          !REAL_SETTLEMENT_AVAILABLE ||
          !size ||
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
                  ? "Submitting..."
                  : `${direction === "long" ? "Open Long" : "Open Short"} ${market}`;
        return (
          <button
            onClick={handleSubmit}
            disabled={disabled}
            className={cn(
              "w-full h-11 text-sm font-medium rounded-xl transition-colors disabled:opacity-50",
              direction === "long"
                ? "bg-success text-success-foreground hover:bg-success/90"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {label}
          </button>
        );
      })()}

      <p className="text-[10px] text-muted-foreground text-center mt-3">
        Shield Wallet required. Testnet only.
      </p>
    </div>
  );
};

export default OrderForm;
