import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MarketPrice {
  symbol: string;
  price: number;
  change24h: number;
  positive: boolean;
}

const MARKET_SYMBOLS = ["BTC-USD", "ETH-USD", "ALEO-USD", "SOL-USD"] as const;

const formatPrice = (price: number): string => {
  if (price >= 1000) return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
};

const usePrices = () => {
  const [prices, setPrices] = useState<MarketPrice[]>([
    { symbol: "BTC-USD", price: 0, change24h: 0, positive: true },
    { symbol: "ETH-USD", price: 0, change24h: 0, positive: true },
    { symbol: "ALEO-USD", price: 0, change24h: 0, positive: false },
    { symbol: "SOL-USD", price: 0, change24h: 0, positive: true },
  ]);
  const [loading, setLoading] = useState(true);
  const errorCountRef = useRef(0);

  const fetchPrices = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("market-prices", {
        body: {},
      });

      if (error) {
        throw new Error(error.message || "Failed to fetch prices from backend");
      }

      const priceMap = data?.prices as Record<string, { price?: number; change24h?: number }> | undefined;
      if (!priceMap) {
        throw new Error("Invalid price payload");
      }

      const updated: MarketPrice[] = MARKET_SYMBOLS.map((symbol) => {
        const row = priceMap[symbol] ?? {};
        const price = Number(row.price ?? 0);
        const change = Number(row.change24h ?? 0);
        return {
          symbol,
          price,
          change24h: change,
          positive: change >= 0,
        };
      });

      const hasAnyPrice = updated.some((p) => p.price > 0);
      if (!hasAnyPrice) {
        throw new Error("No usable prices returned");
      }

      setPrices(updated);
      setLoading(false);
      errorCountRef.current = 0;
    } catch (err) {
      if (errorCountRef.current < 3) {
        console.error("Price fetch error:", err);
      }
      errorCountRef.current++;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 20000); // every 20s
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const getPrice = (symbol: string) => prices.find((p) => p.symbol === symbol);

  return { prices, loading, getPrice, formatPrice };
};

export { formatPrice };
export default usePrices;
