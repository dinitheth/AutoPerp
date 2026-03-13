import { useState } from "react";
import { motion } from "framer-motion";
import Header from "@/components/layout/Header";
import WalletGate from "@/components/wallet/WalletGate";
import PriceBar from "@/components/trading/PriceBar";
import TradingChart from "@/components/trading/TradingChart";
import OrderForm from "@/components/trading/OrderForm";
import PositionsList from "@/components/trading/PositionsList";
import OrderBook from "@/components/trading/OrderBook";

const Trade = () => {
  const [selectedMarket, setSelectedMarket] = useState("BTC-USD");

  return (
    <WalletGate pageName="Trading">
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-14">
        <PriceBar selectedMarket={selectedMarket} onSelectMarket={setSelectedMarket} />

        <div className="flex flex-col lg:flex-row lg:h-[620px] lg:overflow-hidden">
          {/* Chart */}
          <div className="flex-1 border-b lg:border-b-0 lg:border-r border-border lg:min-h-0 lg:min-w-0">
            <TradingChart market={selectedMarket} />
          </div>

          {/* Order Book (middle column) */}
          <div className="w-full lg:w-[320px] lg:h-full lg:min-h-0 overflow-hidden border-b lg:border-b-0 lg:border-r border-border">
            <OrderBook market={selectedMarket} />
          </div>

          {/* Order Form (right column) */}
          <div className="w-full lg:w-[360px] lg:h-full lg:min-h-0 overflow-y-auto lg:overflow-y-visible border-b lg:border-b-0 border-border">
            <OrderForm market={selectedMarket} />
          </div>
        </div>

        {/* Positions */}
        <PositionsList />
      </main>
    </div>
    </WalletGate>
  );
};

export default Trade;
