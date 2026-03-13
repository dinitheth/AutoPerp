import { cn } from "@/lib/utils";
import usePrices, { formatPrice } from "@/hooks/usePrices";

interface PriceBarProps {
  selectedMarket: string;
  onSelectMarket: (market: string) => void;
}

const PriceBar = ({ selectedMarket, onSelectMarket }: PriceBarProps) => {
  const { prices, loading, getPrice } = usePrices();
  const active = getPrice(selectedMarket) || prices[0];

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-0 overflow-x-auto">
        {prices.map((m) => (
          <button
            key={m.symbol}
            onClick={() => onSelectMarket(m.symbol)}
            className={cn(
              "flex items-center gap-3 px-4 py-3 text-xs whitespace-nowrap border-r border-border transition-colors",
              selectedMarket === m.symbol ? "bg-card" : "hover:bg-card/50"
            )}
          >
            <span className="font-medium text-foreground">{m.symbol}</span>
            <span className="font-mono text-foreground">
              {loading && m.price === 0 ? "..." : formatPrice(m.price)}
            </span>
            <span
              className={cn(
                "font-mono",
                m.positive ? "text-success" : "text-destructive"
              )}
            >
              {loading && m.price === 0
                ? "..."
                : `${m.positive ? "+" : ""}${m.change24h.toFixed(2)}%`}
            </span>
          </button>
        ))}
      </div>

      {/* Active market details - mobile */}
      <div className="flex items-center gap-6 px-4 py-2.5 md:hidden border-t border-border bg-card">
        <div>
          <p className="text-[10px] text-muted-foreground">Mark Price</p>
          <p className="text-sm font-mono font-medium text-foreground">
            ${active ? formatPrice(active.price) : "--"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">24h Change</p>
          <p className={cn("text-sm font-mono font-medium", active?.positive ? "text-success" : "text-destructive")}>
            {active ? `${active.positive ? "+" : ""}${active.change24h.toFixed(2)}%` : "--"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Network</p>
          <p className="text-sm font-mono font-medium text-foreground">Testnet</p>
        </div>
      </div>
    </div>
  );
};

export default PriceBar;
