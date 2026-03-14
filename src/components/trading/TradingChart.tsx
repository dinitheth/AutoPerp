import { useEffect, useMemo, useRef } from "react";

interface TradingChartProps {
  market: string;
}

const TradingChart = ({ market }: TradingChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const symbol = useMemo(() => {
    const map: Record<string, string> = {
      "BTC-USD": "BINANCE:BTCUSDT",
      "ETH-USD": "BINANCE:ETHUSDT",
      "ALEO-USD": "MEXC:ALEOUSDT",
    };
    return map[market] || "BINANCE:BTCUSDT";
  }, [market]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "15",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(0, 0, 0, 1)",
      gridColor: "rgba(255, 255, 255, 0.04)",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";

    container.appendChild(widgetDiv);
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container w-full h-[400px] md:h-[520px] lg:h-full"
    />
  );
};

export default TradingChart;
