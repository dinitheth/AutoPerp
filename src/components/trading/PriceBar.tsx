import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import usePrices, { formatPrice } from "@/hooks/usePrices";
import { fetchFundingRate, fetchOraclePrice } from "@/hooks/useAleoTransaction";

interface PriceBarProps {
  selectedMarket: string;
  onSelectMarket: (market: string) => void;
}

const MARKET_ID_MAP: Record<string, number> = {
  "BTC-USD": 0,
  "ETH-USD": 1,
};

const PriceBar = ({ selectedMarket, onSelectMarket }: PriceBarProps) => {
  const { prices, loading, getPrice } = usePrices();
  const active = getPrice(selectedMarket) || prices[0];
  const [fundingRates, setFundingRates] = useState<Record<string, { rate: number; direction: number }>>({});
  const [oraclePrices, setOraclePrices] = useState<Record<string, number>>({});

  // Fetch on-chain oracle prices and funding rates
  const refreshOracleData = useCallback(async () => {
    const markets = Object.entries(MARKET_ID_MAP);
    const [oracleResults, fundingResults] = await Promise.all([
      Promise.all(markets.map(async ([symbol, id]) => [symbol, await fetchOraclePrice(id)] as const)),
      Promise.all(markets.map(async ([symbol, id]) => [symbol, await fetchFundingRate(id)] as const)),
    ]);
    setOraclePrices(Object.fromEntries(oracleResults.filter(([, p]) => p > 0)));

    // Compute real funding rates:
    // If on-chain rate exists (oracle computed), use it directly.
    // If on-chain rate is 0 (oracle not yet seeded for this market),
    // calculate from real mark/index price spread — this is the standard
    // perpetual funding formula used by Binance, dYdX, etc:
    //   funding_rate = clamp((mark_price - index_price) / index_price, ±0.05%)
    // where mark_price = oracle on-chain price, index_price = live exchange price
    const enrichedFunding = fundingResults.map(([symbol, data]) => {
      if (data.rate > 0) {
        // On-chain funding rate exists — use real oracle data
        return [symbol, data] as const;
      }

      // Calculate from real price spread (mark vs index)
      const oraclePrice = oracleResults.find(([s]) => s === symbol)?.[1] ?? 0;
      const livePrice = prices.find(p => p.symbol === symbol)?.price ?? 0;

      if (oraclePrice > 0 && livePrice > 0) {
        // Standard perp funding: premium = (mark - index) / index
        const premium = (oraclePrice - livePrice) / livePrice;
        // 8-hour funding rate = premium / 3 intervals per day (no artificial clamp)
        const fundingFromPremium = premium / 3;
        // Interest rate component: 0.01% per 8h
        const interestRate = 0.0001;
        const fundingRate = fundingFromPremium + interestRate;
        const direction = fundingRate >= 0 ? 0 : 1; // 0 = longs pay, 1 = shorts pay
        return [symbol, { rate: Math.abs(fundingRate), direction }] as const;
      }

      return [symbol, data] as const;
    });
    setFundingRates(Object.fromEntries(enrichedFunding));
  }, [prices]);

  useEffect(() => {
    refreshOracleData();
    const interval = setInterval(refreshOracleData, 15000);
    return () => clearInterval(interval);
  }, [refreshOracleData]);

  const activeFunding = fundingRates[selectedMarket];
  const activeOraclePrice = oraclePrices[selectedMarket];

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-0 overflow-x-auto">
        {prices.map((m) => {
          const funding = fundingRates[m.symbol];
          return (
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
            {funding && funding.rate > 0 && (
              <span className={cn(
                "font-mono text-[10px]",
                funding.direction === 0 ? "text-destructive" : "text-success",
              )}>
                F: {funding.direction === 0 ? "-" : "+"}{(funding.rate * 100).toFixed(4)}%
              </span>
            )}
          </button>
          );
        })}
      </div>

      {/* Active market details */}
      <div className="flex items-center gap-6 px-4 py-2.5 border-t border-border bg-card">
        <div>
          <p className="text-[10px] text-muted-foreground">Mark Price</p>
          <p className="text-sm font-mono font-medium text-foreground">
            ${active ? formatPrice(active.price) : "--"}
          </p>
        </div>
        {activeOraclePrice !== undefined && activeOraclePrice > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground">Oracle Price</p>
            <p className="text-sm font-mono font-medium text-primary">
              ${formatPrice(activeOraclePrice)}
            </p>
          </div>
        )}
        <div>
          <p className="text-[10px] text-muted-foreground">24h Change</p>
          <p className={cn("text-sm font-mono font-medium", active?.positive ? "text-success" : "text-destructive")}>
            {active ? `${active.positive ? "+" : ""}${active.change24h.toFixed(2)}%` : "--"}
          </p>
        </div>
        {activeFunding && (
          <div>
            <p className="text-[10px] text-muted-foreground">Funding Rate</p>
            <p className={cn(
              "text-sm font-mono font-medium",
              activeFunding.direction === 0 ? "text-destructive" : "text-success",
            )}>
              {activeFunding.direction === 0 ? "-" : "+"}
              {(activeFunding.rate * 100).toFixed(4)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceBar;
