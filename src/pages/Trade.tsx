import { useState } from "react";
import { motion } from "framer-motion";
import Header from "@/components/layout/Header";
import WalletGate from "@/components/wallet/WalletGate";
import PriceBar from "@/components/trading/PriceBar";
import TradingChart from "@/components/trading/TradingChart";
import OrderForm from "@/components/trading/OrderForm";
import PositionsList from "@/components/trading/PositionsList";
import OrderBook from "@/components/trading/OrderBook";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  type TradingMode,
  getStoredTradingMode,
  resolveCoreProgram,
  setStoredTradingMode,
} from "@/lib/protocol";

const Trade = () => {
  const [selectedMarket, setSelectedMarket] = useState("BTC-USD");
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => getStoredTradingMode());
  const [showPrivateInfo, setShowPrivateInfo] = useState(false);
  const isPrivateMode = tradingMode === "private";
  const coreProgram = resolveCoreProgram(tradingMode);

  const handleModeChange = (mode: TradingMode) => {
    const switchedToPrivate = mode === "private" && tradingMode !== "private";
    setTradingMode(mode);
    setStoredTradingMode(mode);
    if (switchedToPrivate) {
      setShowPrivateInfo(true);
    }
  };

  return (
    <WalletGate pageName="Trading">
    <div className="min-h-screen bg-background">
      <Header />

      <Dialog open={showPrivateInfo} onOpenChange={setShowPrivateInfo}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Private Mode: 4 approvals required</DialogTitle>
            <DialogDescription>
              In private mode, opening a trade requires sequential approvals in Shield.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="text-foreground font-medium">Approve these transactions in order:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Create private vault</li>
              <li>Bootstrap private pool state</li>
              <li>Fund private vault collateral</li>
              <li>Open private position (final)</li>
            </ol>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
              Position records and private state are private; token settlement legs may still appear on explorer.
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowPrivateInfo(false)}
                className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Continue
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <main className="pt-14">
        <PriceBar selectedMarket={selectedMarket} onSelectMarket={setSelectedMarket} />

        <div className="border-b border-border px-4 py-2">
          <div className="container flex items-center justify-end gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Mode</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              <button
                onClick={() => handleModeChange("private")}
                className={`h-7 px-3 text-xs rounded-md transition-colors ${
                  isPrivateMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Private
              </button>
              <button
                onClick={() => handleModeChange("public")}
                className={`h-7 px-3 text-xs rounded-md transition-colors ${
                  !isPrivateMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Public
              </button>
            </div>
          </div>
        </div>

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
            <OrderForm market={selectedMarket} coreProgram={coreProgram} isPrivateMode={isPrivateMode} />
          </div>
        </div>

        {/* Positions */}
        <PositionsList coreProgram={coreProgram} isPrivateMode={isPrivateMode} />
      </main>
    </div>
    </WalletGate>
  );
};

export default Trade;
