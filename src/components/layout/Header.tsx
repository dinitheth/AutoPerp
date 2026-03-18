import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { getStoredTradingMode, setStoredTradingMode, TRADING_MODE_STORAGE_KEY, type TradingMode } from "@/lib/protocol";

const navItems = [
  { label: "Trade", path: "/trade" },
  { label: "Portfolio", path: "/portfolio" },
  { label: "Pool", path: "/pool" },
  { label: "Agent", path: "/agent" },
  { label: "Faucet", path: "/faucet" },
  { label: "Docs", path: "/docs" },
];

const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => getStoredTradingMode());

  useEffect(() => {
    const fn = (e: CustomEvent<TradingMode>) => setTradingMode(e.detail);
    window.addEventListener("autoperp:mode-changed", fn as EventListener);
    
    // Catch storage events from other tabs
    const storeFn = (e: StorageEvent) => {
      if (e.key === TRADING_MODE_STORAGE_KEY && (e.newValue === "public" || e.newValue === "private")) {
        setTradingMode(e.newValue as TradingMode);
      }
    };
    window.addEventListener("storage", storeFn);
    
    return () => {
      window.removeEventListener("autoperp:mode-changed", fn as EventListener);
      window.removeEventListener("storage", storeFn);
    };
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass glass-border">
      <div className="container flex h-14 items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-xs font-bold tracking-tight">AP</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">AutoPerp</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            if (item.path === "/agent" && tradingMode === "private") return null;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Mode</span>
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              <button
                onClick={() => setStoredTradingMode("private")}
                className={`h-7 px-3 text-xs rounded-md transition-colors ${
                  tradingMode === "private" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Private
              </button>
              <button
                onClick={() => setStoredTradingMode("public")}
                className={`h-7 px-3 text-xs rounded-md transition-colors ${
                  tradingMode === "public" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Public
              </button>
            </div>
          </div>
          <ConnectWalletButton className="hidden md:inline-flex" />

          <button
            className="md:hidden p-1.5 text-muted-foreground"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden overflow-hidden border-t border-border"
          >
            <div className="container py-3 flex flex-col gap-1">
              {navItems.map((item) => {
                if (item.path === "/agent" && tradingMode === "private") return null;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`px-3 py-2.5 text-sm rounded-lg transition-colors ${
                      isActive
                        ? "text-foreground bg-secondary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <ConnectWalletButton className="mt-2 w-full h-10" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
};

export default Header;
