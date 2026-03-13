import { useState } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, ChevronDown } from "lucide-react";

const MARKETS = ["BTC-USD", "ETH-USD", "ALEO-USD"] as const;
const DIRECTIONS = ["long", "short"] as const;
const LEVERAGES = [1, 2, 5, 10, 25, 50] as const;

interface TradeSetupFormProps {
  onSubmit: (params: {
    market: string;
    direction: "long" | "short";
    collateral: number;
    leverage: number;
    stopLoss?: number;
    takeProfit?: number;
  }) => void;
  disabled?: boolean;
  preselectedMarket?: string;
}

const TradeSetupForm = ({ onSubmit, disabled, preselectedMarket }: TradeSetupFormProps) => {
  const [market, setMarket] = useState(preselectedMarket || "");
  const [direction, setDirection] = useState<"long" | "short" | "">("");
  const [leverage, setLeverage] = useState<number | null>(null);
  const [collateral, setCollateral] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canSubmit =
    market && direction && leverage && parseFloat(collateral) >= 1 && !disabled;

  const handleSubmit = () => {
    if (!canSubmit || !direction || !leverage) return;
    onSubmit({
      market,
      direction,
      collateral: parseFloat(collateral),
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
    });
  };

  return (
    <div className="mt-3 space-y-3 p-3 rounded-xl bg-secondary/30 border border-border">
      {/* Market Selection */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
          Market
        </p>
        <div className="flex gap-1.5">
          {MARKETS.map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={cn(
                "flex-1 h-8 text-xs font-medium rounded-lg border transition-colors",
                market === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
              )}
            >
              {m.split("-")[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Direction */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
          Direction
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={() => setDirection("long")}
            className={cn(
              "flex-1 h-8 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-colors",
              direction === "long"
                ? "bg-success/15 text-success border-success/30"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
            )}
          >
            <TrendingUp className="h-3 w-3" />
            Long
          </button>
          <button
            onClick={() => setDirection("short")}
            className={cn(
              "flex-1 h-8 text-xs font-medium rounded-lg border flex items-center justify-center gap-1.5 transition-colors",
              direction === "short"
                ? "bg-destructive/15 text-destructive border-destructive/30"
                : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
            )}
          >
            <TrendingDown className="h-3 w-3" />
            Short
          </button>
        </div>
      </div>

      {/* Leverage */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
          Leverage
        </p>
        <div className="grid grid-cols-6 gap-1">
          {LEVERAGES.map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={cn(
                "h-7 text-[10px] font-medium rounded-md border transition-colors",
                leverage === lev
                  ? lev >= 25
                    ? "bg-warning/15 text-warning border-warning/30"
                    : "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
              )}
            >
              {lev}x
            </button>
          ))}
        </div>
        {leverage && leverage >= 25 && (
          <p className="text-[9px] text-warning mt-1">
            High leverage increases liquidation risk significantly.
          </p>
        )}
      </div>

      {/* Collateral */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
          Collateral (USDCx)
        </p>
        <input
          type="number"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
          placeholder="Min 1 USDCx"
          min="1"
          step="0.01"
          className="w-full h-8 px-3 text-xs bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Advanced SL/TP */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", showAdvanced && "rotate-180")}
        />
        Stop Loss / Take Profit (optional)
      </button>

      {showAdvanced && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[9px] text-muted-foreground mb-1">Stop Loss ($)</p>
            <input
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="Price"
              className="w-full h-7 px-2 text-[10px] bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <p className="text-[9px] text-muted-foreground mb-1">Take Profit ($)</p>
            <input
              type="number"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="Price"
              className="w-full h-7 px-2 text-[10px] bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full h-9 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
      >
        {!market
          ? "Select a market"
          : !direction
          ? "Choose direction"
          : !leverage
          ? "Pick leverage"
          : !collateral || parseFloat(collateral) < 1
          ? "Enter collateral (min 1 USDCx)"
          : "Submit Order Details"}
      </button>
    </div>
  );
};

export default TradeSetupForm;
