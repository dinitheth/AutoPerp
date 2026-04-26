import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  HelpCircle,
  Key,
  Loader2,
  Send,
  Shield,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Header from "@/components/layout/Header";
import WalletGate from "@/components/wallet/WalletGate";
import { useAgent } from "@/hooks/useAgent";
import type { TradeParams } from "@/hooks/useAgent";
import usePrices, { formatPrice } from "@/hooks/usePrices";
import useUsdcxBalance from "@/hooks/useUsdcxBalance";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import AgentMessageContent from "@/components/agent/AgentMessageContent";
import TradeSetupForm from "@/components/agent/TradeSetupForm";
import { useAleoTransaction, API_BASE, MARKET_IDS, toPrice, toUsdcx } from "@/hooks/useAleoTransaction";
import { addOrder, addTradeEventPersistent, newId } from "@/lib/portfolioStore";
import {
  LEGACY_SETTLEMENT_MESSAGE,
  PROGRAMS,
  PUBLIC_CORE_PROGRAM,
  REAL_SETTLEMENT_AVAILABLE,
  getStoredTradingMode,
  TRADING_MODE_STORAGE_KEY,
  type TradingMode,
} from "@/lib/protocol";
import { useAgentAuth, AGENT_PERMISSIONS, permissionLabels } from "@/hooks/useAgentAuth";
import { toast } from "sonner";

const suggestions = [
  {
    icon: TrendingUp,
    label: "Open a position",
    message: "I want to open a leveraged position. What markets are available?",
  },
  {
    icon: BarChart3,
    label: "Set SL/TP",
    message: "Help me set stop-loss and take-profit for a BTC-USD position",
  },
  {
    icon: Wallet,
    label: "Check my balance",
    message: "What is my current USDCx balance and how much can I trade with?",
  },
  {
    icon: HelpCircle,
    label: "How does AutoPerp work?",
    message: "Explain how AutoPerp's privacy model and AgentAuth permissions currently work",
  },
];

const Agent = () => {
  const [input, setInput] = useState("");
  const [agentExecuteInput, setAgentExecuteInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const lastTradeStatusRef = useRef<"pending" | "executed" | "failed" | null>(null);
  const [showAuthPanel, setShowAuthPanel] = useState(false);

  const { prices, getPrice } = usePrices();
  const { usdcxBalance, creditsBalance, refetch: refetchBalance } = useUsdcxBalance();
  const { connected, address } = useWallet();
  const { execute, loading: txLoading, getLastError } = useAleoTransaction();
  const {
    activeAuths,
    receipts,
    loading: authLoading,
    grantAuth,
    executeAgentAction,
    revokeAuth,
    getAgentExecutionCount,
  } = useAgentAuth();
  const AGENT_CORE_PROGRAM = PUBLIC_CORE_PROGRAM;
  
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => getStoredTradingMode());

  useEffect(() => {
    const handleModeEvent = (e: CustomEvent<TradingMode>) => setTradingMode(e.detail);
    window.addEventListener("autoperp:mode-changed", handleModeEvent as EventListener);
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === TRADING_MODE_STORAGE_KEY && (e.newValue === "public" || e.newValue === "private")) {
        setTradingMode(e.newValue as TradingMode);
      }
    };
    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener("autoperp:mode-changed", handleModeEvent as EventListener);
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, []);



  const { messages, isLoading, sendMessage, queueOpenPosition, appendAgentMessage, getPendingTradeParams, markActionExecuted, rejectAction } =
    useAgent({
      prices,
      usdcxBalance,
      creditsBalance,
      walletConnected: connected,
      walletAddress: address ?? null,
    });

  const lastTradeAction = [...messages]
    .reverse()
    .find((m) => m.action?.type === "OPEN_POSITION");
  const shouldShowSuggestions =
    !suggestionsDismissed &&
    (messages.length <= 1 ||
      (!!lastTradeAction &&
        lastTradeAction.action?.status !== "pending" &&
        !isLoading &&
        !txLoading));

  useEffect(() => {
    const status = lastTradeAction?.action?.status ?? null;
    if (!status) return;
    const prev = lastTradeStatusRef.current;
    // When a trade action finishes, show suggestions again.
    if (prev === "pending" && status !== "pending") {
      setSuggestionsDismissed(false);
    }
    lastTradeStatusRef.current = status;
  }, [lastTradeAction?.action?.status]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distance < 120;
    };
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (scrollRef.current && stickToBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = useCallback((text?: string) => {
    const msg = text || input.trim();
    if (!msg || isLoading) return;
    setInput("");
    setSuggestionsDismissed(true);
    sendMessage(msg);
  }, [input, isLoading, sendMessage]);

  const handleConfirm = useCallback(async (msgId: string, overrideParams?: TradeParams) => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      rejectAction(msgId);
      appendAgentMessage(`Trade rejected. ${LEGACY_SETTLEMENT_MESSAGE}`);
      return;
    }

    const tradeParams = overrideParams ?? getPendingTradeParams(msgId);
    if (!tradeParams) {
      appendAgentMessage("Confirmed.");
      return;
    }

    if (!connected || !address) {
      toast.error("Wallet not connected.");
      rejectAction(msgId);
      appendAgentMessage("Trade rejected - wallet is not connected. Please connect your Shield wallet first.");
      return;
    }

    const marketId = MARKET_IDS[tradeParams.market];
    if (!marketId) {
      toast.error("Unsupported market.");
      rejectAction(msgId);
      appendAgentMessage(`Trade rejected - market ${tradeParams.market} is not supported on-chain.`);
      return;
    }

    // Step 2: Open position (price must be available at the moment we open).
    const currentPrice = getPrice(tradeParams.market)?.price ?? 0;
    if (currentPrice <= 0) {
      toast.error("Price feed not ready yet. Please wait a moment and retry.");
      // Keep pending so the user can retry without losing the prepared action.
      return;
    }

    // Use oracle price for on-chain entry_price to pass the V9 divergence check
    const { fetchOraclePrice } = await import("@/hooks/useAleoTransaction");
    const marketIdNum = parseInt(MARKET_IDS[tradeParams.market] ?? "0");
    let onChainEntryPrice = currentPrice;
    try {
      const oraclePrice = await fetchOraclePrice(marketIdNum);
      if (oraclePrice > 0) {
        onChainEntryPrice = oraclePrice;
      } else {
        toast.error(`Oracle price unavailable for ${tradeParams.market}. Cannot open position.`);
        rejectAction(msgId);
        return;
      }
    } catch {
      // fall through with live price
    }

    const directionVal = tradeParams.direction === "long" ? "0u8" : "1u8";
    const sl = tradeParams.stopLoss ? toPrice(tradeParams.stopLoss) : "0u64";
    const tp = tradeParams.takeProfit ? toPrice(tradeParams.takeProfit) : "0u64";
    const paramsInput = `{ market_id: ${marketId}, direction: ${directionVal}, collateral: ${toUsdcx(tradeParams.collateral)}, leverage: ${tradeParams.leverage}u64, entry_price: ${toPrice(onChainEntryPrice)}, stop_loss: ${sl}, take_profit: ${tp} }`;
    let result = null;
    const parseMappingBalance = (raw: string): number => {
      const structMatch = raw.match(/balance:\s*([\d_]+)u(?:64|128)/i);
      const value = structMatch?.[1] ?? raw;
      const cleaned = value
        .replace(/"/g, "")
        .replace(/u\d+$/i, "")
        .replace(/field$/i, "")
        .replace(/_/g, "")
        .trim();
      const n = Number.parseInt(cleaned, 10);
      return Number.isFinite(n) ? n : 0;
    };

    let publicVaultBal = 0;
    try {
      const vres = await fetch(`${API_BASE}/program/${AGENT_CORE_PROGRAM}/mapping/vault/${address}`);
      if (vres.ok) {
        const vraw = await vres.text();
        publicVaultBal = parseMappingBalance(vraw) / 1_000_000;
      }
    } catch {
      publicVaultBal = 0;
    }

    const walletBal = parseFloat(usdcxBalance ?? "0");
    const neededDeposit = Math.max(0, tradeParams.collateral - publicVaultBal);

    if (neededDeposit > walletBal) {
      toast.error(
        `Insufficient balance: need ${neededDeposit.toFixed(2)} USDCx from wallet, but only ${walletBal.toFixed(2)} USDCx is available.`,
      );
      rejectAction(msgId);
      appendAgentMessage(
        `Trade rejected - insufficient USDCx in wallet. You need ${neededDeposit.toFixed(
          2,
        )} USDCx to lock collateral, but your wallet has ${walletBal.toFixed(2)} USDCx available.`,
      );
      return;
    }

    if (neededDeposit > 0) {
      toast.info(`Locking ${neededDeposit.toFixed(2)} USDCx as collateral — approve in Shield...`);
      const depositResult = await execute(AGENT_CORE_PROGRAM, "deposit_collateral", [toUsdcx(neededDeposit)]);
      if (!depositResult) {
        const err = (getLastError() ?? "Unknown error").trim();
        const e = err.toLowerCase();
        const isNoResponse = e.includes("no response") || e.includes("timeout") || e.includes("could not confirm");
        const isUserCancel = e.includes("reject") || e.includes("cancel") || e.includes("refused") || e.includes("denied");
        const isWalletLocked = e.includes("locked") || e.includes("unlock") || e.includes("authentication");

        if ((isNoResponse || isWalletLocked) && !isUserCancel) {
          toast.error("Shield wallet is locked or not responding while locking collateral. Unlock Shield and retry.");
          return;
        }

        rejectAction(msgId);
        appendAgentMessage(`Transaction failed while locking collateral: ${err}`);
        return;
      }

      // Wait for deposit to confirm on-chain before opening position
      toast.info("Waiting for collateral deposit to confirm on-chain...");
      let depositConfirmed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(r => setTimeout(r, 5000)); // poll every 5s
        try {
          const vres = await fetch(`${API_BASE}/program/${AGENT_CORE_PROGRAM}/mapping/vault/${address}`);
          if (vres.ok) {
            const vraw = await vres.text();
            const confirmedBal = parseMappingBalance(vraw) / 1_000_000;
            if (confirmedBal >= tradeParams.collateral * 0.95) { // within 5% tolerance
              depositConfirmed = true;
              break;
            }
          }
        } catch { /* retry */ }
      }

      if (!depositConfirmed) {
        toast.error("Collateral deposit timed out. Please try again — your deposit may still be processing.");
        return;
      }
      toast.success("Collateral confirmed on-chain!");
      setTimeout(() => refetchBalance(), 2500);
    }

    // Fetch next position ID from on-chain before opening
    let positionIdInput = "1u64";
    try {
      const { fetchNextPositionId } = await import("@/hooks/useAleoTransaction");
      const mid = parseInt(MARKET_IDS[tradeParams.market] ?? "0");
      positionIdInput = await fetchNextPositionId(AGENT_CORE_PROGRAM, mid);
    } catch {
      positionIdInput = "1u64";
    }

    toast.info("Opening position on Aleo — approve in Shield...");
    result = await execute(AGENT_CORE_PROGRAM, "open_position", [paramsInput, address, positionIdInput]);

    if (result) {
      markActionExecuted(msgId);
      const txHash = result.transactionId;
      const explorerUrl = `https://testnet.explorer.provable.com/transaction/${txHash}`;

      // Persist real execution into Portfolio (local history for this wallet/browser).
      addOrder({
        id: newId("order"),
        market: tradeParams.market,
        side: tradeParams.direction,
        kind: "market",
        collateralUsdcx: tradeParams.collateral,
        leverage: tradeParams.leverage,
        limitPrice: undefined,
        stopLoss: tradeParams.stopLoss ?? undefined,
        takeProfit: tradeParams.takeProfit ?? undefined,
        createdAt: Date.now(),
        status: "executed",
        executedTxId: txHash,
      }, address);
      addTradeEventPersistent({
        id: newId("trade"),
        type: "OPEN",
        market: tradeParams.market,
        side: tradeParams.direction,
        collateralUsdcx: tradeParams.collateral,
        leverage: tradeParams.leverage,
        entryPrice: currentPrice,
        txId: txHash,
        ts: Date.now(),
      }, address);

      // Tag this position as agent-opened so the Trade page can show a badge
      try {
        const posIdNum = positionIdInput.replace(/u\d+$/i, "");
        const key = `autoperp:agent-positions:${address.toLowerCase()}`;
        const existing = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
        if (!existing.includes(posIdNum)) {
          existing.push(posIdNum);
          localStorage.setItem(key, JSON.stringify(existing));
        }
      } catch { /* non-critical */ }

      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 2500);

      appendAgentMessage(
        `✅ **Trade executed on-chain successfully!**\n\nAleo TX Hash: \`${txHash}\`\n\n[View on Aleo Explorer](${explorerUrl})\n\nYour position is now active — head to the **[Trade page](/trade)** to monitor it in real-time under the **Positions** tab.`,
      );
      toast.success("Transaction confirmed on Aleo blockchain!", {
        description: `TX: ${txHash.slice(0, 20)}...`,
        action: {
          label: "View on Explorer",
          onClick: () => window.open(explorerUrl, "_blank"),
        },
      });

      // Grant AgentAuth after trade succeeds (non-blocking background call)
      grantAuth({
        agentAddress: address,
        positionHash: String(Math.floor(Math.random() * 1_000_000_000)),
        permissions: AGENT_PERMISSIONS.ALL,
        maxSlippageBps: 100,
        marketId: parseInt(MARKET_IDS[tradeParams.market] ?? "0"),
        expiryBlockHeight: Math.floor(Date.now() / 1000) + 100000,
      }).catch(() => console.warn("AgentAuth grant skipped (non-critical)"));
    } else {
      const err = (getLastError() ?? "Unknown error").trim();
      const e = err.toLowerCase();
      const isNoResponse = e.includes("no response") || e.includes("timeout") || e.includes("could not confirm");
      const isUserCancel = e.includes("reject") || e.includes("cancel") || e.includes("refused") || e.includes("denied");

      if (isNoResponse && !isUserCancel) {
        // Keep action pending so user can retry (do not spam the chat thread).
        toast.error("Shield returned no response while opening the position. If you approved, check the explorer; otherwise retry.");
        return;
      }

      rejectAction(msgId);
      appendAgentMessage(`Transaction failed while opening the position: ${err}`);
    }
  }, [
    address,
    appendAgentMessage,
    connected,
    execute,
    getLastError,
    getPendingTradeParams,
    getPrice,
    markActionExecuted,
    refetchBalance,
    rejectAction,
    usdcxBalance,
    AGENT_CORE_PROGRAM,
    grantAuth,
  ]);

  const handleExecuteAgentAction = useCallback(async (msgId: string) => {
    if (!agentExecuteInput.trim() || !connected || !address) {
      toast.error("Please paste your AgentAuth record first");
      return;
    }

    toast.info("Executing Agent Action on Aleo - approve in Shield...");
    // Attempt standard open market parameters simulating AI logic
    const currentPrice = getPrice("BTC-USD")?.price ?? 60000;
    
    try {
      const receipt = await executeAgentAction({
        authRecordInput: agentExecuteInput.trim(),
        actionType: 0, // open
        executionPrice: currentPrice,
      });

      if (receipt) {
        markActionExecuted(msgId);
        setAgentExecuteInput("");
        appendAgentMessage(`Agent Executed Trade Successfully!\n\nReceipt TX Hash: \`${receipt.txId}\`\n\nI have consumed your AgentAuth record and generated a cryptographic Execution Receipt.`);
        toast.success("Agent Action Confirmed", { description: "Cryptographic receipt generated." });
      } else {
        const err = getLastError();
        rejectAction(msgId);
        appendAgentMessage(`Agent Execution Failed: ${err}`);
      }
    } catch (err: any) {
      rejectAction(msgId);
      appendAgentMessage(`Agent Execution Failed: ${err?.message || "Unknown error"}`);
    }
  }, [agentExecuteInput, connected, address, executeAgentAction, getPrice, markActionExecuted, rejectAction, appendAgentMessage, getLastError]);

  // Note: Shield wallet approvals are most reliable when triggered by a user gesture (button click).

  const handleTradeFormSubmit = (params: TradeParams) => {
    if (!REAL_SETTLEMENT_AVAILABLE) {
      toast.error(LEGACY_SETTLEMENT_MESSAGE);
      appendAgentMessage(`I can't place a live trade on this deployment. ${LEGACY_SETTLEMENT_MESSAGE}`);
      return;
    }

    const currentPrice = getPrice(params.market)?.price ?? 0;
    if (currentPrice <= 0) {
      toast.error("Price feed not ready yet.");
      appendAgentMessage(`Prices are still loading for ${params.market}. Try again in a few seconds.`);
      return;
    }

    const notional = params.collateral * params.leverage;
    const feeUsd = notional * 0.0006;
    const liq =
      params.direction === "long"
        ? currentPrice * (1 - 0.9 / params.leverage)
        : currentPrice * (1 + 0.9 / params.leverage);

    let risk = "Low";
    if (params.leverage >= 10) risk = "Medium";
    if (params.leverage >= 25) risk = "High";
    if (params.leverage >= 50) risk = "Very High";

    const slTxt = params.stopLoss ? `$${params.stopLoss.toLocaleString()}` : "Not set";
    const tpTxt = params.takeProfit ? `$${params.takeProfit.toLocaleString()}` : "Not set";

    const summary = `Open ${params.direction.toUpperCase()} ${params.market} with ${params.collateral} USDCx collateral at ${params.leverage}x leverage`;
    const details =
      `Collateral: ${params.collateral} USDCx | ` +
      `Leverage: ${params.leverage}x | ` +
      `Position Size: $${notional.toFixed(2)} | ` +
      `Entry Price: ~$${currentPrice.toFixed(2)} | ` +
      `Stop Loss: ${slTxt} | ` +
      `Take Profit: ${tpTxt} | ` +
      `Liquidation Price: ~$${liq.toFixed(2)} | ` +
      `Fee: $${feeUsd.toFixed(2)} | ` +
      `Risk Level: ${risk}`;

    const actionMsgId = queueOpenPosition(params, summary, details);
    // Run inside the same user flow that submitted the form (more reliable for wallet popups).
    void handleConfirm(actionMsgId, params);
  };



  return (
    <WalletGate pageName="the Agent">
      <div className="fixed inset-0 bg-background flex flex-col">
        <Header />

        <div className="flex-1 flex flex-col pt-14 min-h-0">
          <div className="border-b border-border px-4 py-3 shrink-0">
            <div className="container max-w-3xl flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">AutoPerp Agent</p>
                <p className="text-[10px] text-muted-foreground">
                  Powered by Gemini AI
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                {connected && usdcxBalance && (
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                    {usdcxBalance} USDCx
                  </span>
                )}
                <button
                  onClick={() => setShowAuthPanel(!showAuthPanel)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
                    showAuthPanel
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "bg-card border border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Key className="h-3 w-3" />
                  Permissions{activeAuths.filter((a) => a.isActive).length > 0 && (
                    <span className="ml-1 px-1 py-0.5 rounded bg-success/20 text-success text-[9px]">
                      {activeAuths.filter((a) => a.isActive).length}
                    </span>
                  )}
                </button>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3 w-3 text-success" />
                  <span className="text-[10px] text-success">AgentAuth active</span>
                </div>
              </div>
            </div>
          </div>

          {/* AgentAuth Permissions Panel */}
          {showAuthPanel && (
            <div className="border-b border-border px-4 py-3 bg-card/50 shrink-0">
              <div className="container max-w-3xl">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-foreground">AgentAuth Permissions</span>
                  <span className="text-[10px] text-muted-foreground">({PROGRAMS.AGENT})</span>
                </div>
                {activeAuths.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">
                    No active agent authorizations. Permissions are granted automatically when you execute trades via the agent.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {activeAuths.map((auth) => (
                      <div
                        key={auth.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border bg-card text-[10px]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded font-medium",
                              auth.isActive
                                ? "bg-success/10 text-success"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {auth.isActive ? "Active" : "Used"}
                          </span>
                          <span className="text-muted-foreground">
                            Permissions: {permissionLabels(auth.permissions).join(", ")}
                          </span>
                          <span className="text-muted-foreground">Slippage: {auth.maxSlippage / 100}%</span>
                        </div>
                        {auth.isActive && (
                          <button
                            onClick={() => revokeAuth(auth.id)}
                            className="px-2 py-0.5 rounded text-destructive border border-destructive/30 hover:bg-destructive/10 transition-colors"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {receipts.length > 0 && (
                  <div className="mt-2 border-t border-border/50 pt-2">
                    <p className="text-[10px] font-medium text-foreground mb-1">Execution Receipts</p>
                    {receipts.slice(0, 3).map((r, i) => (
                      <div key={i} className="text-[10px] text-muted-foreground font-mono">
                        Action #{r.actionType} @ ${r.executionPrice.toFixed(2)} — TX: {r.txId.slice(0, 16)}...
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!REAL_SETTLEMENT_AVAILABLE && (
            <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning shrink-0">
              <div className="container max-w-3xl">{LEGACY_SETTLEMENT_MESSAGE}</div>
            </div>
          )}

          <div className="border-b border-border px-4 py-1.5 overflow-x-auto shrink-0">
            <div className="container max-w-3xl flex items-center gap-4">
              {prices.map((p) => (
                <div key={p.symbol} className="flex items-center gap-2 text-[10px] whitespace-nowrap">
                  <span className="text-muted-foreground">{p.symbol}</span>
                  <span className="font-mono text-foreground">${formatPrice(p.price)}</span>
                  <span className={cn("font-mono", p.positive ? "text-success" : "text-destructive")}>
                    {p.positive ? "+" : ""}
                    {p.change24h.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="container max-w-3xl py-4 space-y-4">
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border",
                    )}
                  >
                    <AgentMessageContent
                      content={msg.content}
                      isUser={msg.role === "user"}
                      onSelectMarket={(selectedMarket) => {
                        sendMessage(`I want to trade ${selectedMarket}. Set up a position for me.`);
                      }}
                    />

                    {msg.showTradeForm && (
                      <TradeSetupForm
                        onSubmit={(p) => void handleTradeFormSubmit(p)}
                        disabled={isLoading}
                        preselectedMarket={msg.preselectedMarket}
                      />
                    )}

                    {msg.action && (
                      <div className="mt-3 p-3 rounded-xl bg-secondary/50 border border-border">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-mono font-medium text-primary">
                            {msg.action.type}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded font-medium",
                              msg.action.status === "pending"
                                ? "bg-warning/10 text-warning"
                                : msg.action.status === "executed"
                                  ? "bg-success/10 text-success"
                                  : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {msg.action.status === "executed" ? "on-chain ok" : msg.action.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono leading-relaxed">
                          {msg.action.details}
                        </p>
                        {msg.action.status === "pending" && msg.action.type === "OPEN_POSITION" && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleConfirm(msg.id)}
                              disabled={txLoading}
                              className="h-7 px-3 text-[10px] font-medium rounded-lg bg-success text-success-foreground hover:bg-success/90 transition-colors disabled:opacity-50"
                            >
                              {txLoading ? "Executing..." : "Execute On-Chain"}
                            </button>
                            <button
                              onClick={() => rejectAction(msg.id)}
                              className="h-7 px-3 text-[10px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {msg.action.status === "pending" && msg.action.type === "EXECUTE_AGENT_ACTION" && (
                          <div className="flex flex-col gap-2 mt-3">
                            <input
                              type="text"
                              value={agentExecuteInput}
                              onChange={(e) => setAgentExecuteInput(e.target.value)}
                              placeholder="Paste encrypted AgentAuth record ({ owner: aleo1..., ... })"
                              className="h-8 px-3 text-[10px] bg-background border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleExecuteAgentAction(msg.id)}
                                disabled={authLoading || !agentExecuteInput.trim()}
                                className="h-7 px-3 flex-1 text-[10px] font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                              >
                                {authLoading ? "Executing..." : "Sign & Execute Agent Action"}
                              </button>
                              <button
                                onClick={() => rejectAction(msg.id)}
                                className="h-7 px-3 text-[10px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-[9px] text-muted-foreground mt-2 opacity-60">
                      {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </motion.div>
              ))}

              {isLoading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Analyzing...</span>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {shouldShowSuggestions && (
            <div className="border-t border-border px-4 py-3 shrink-0">
              <div className="container max-w-3xl">
                <p className="text-[10px] text-muted-foreground mb-2">Suggestions</p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.message)}
                      disabled={isLoading}
                      className="flex items-center gap-2 p-2.5 text-left rounded-xl border border-border bg-card hover:bg-secondary transition-colors disabled:opacity-50"
                    >
                      <s.icon className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-xs text-foreground">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-border p-4 shrink-0">
            <div className="container max-w-3xl">
              {!shouldShowSuggestions && messages.length > 1 && (
                <div className="mb-2 flex justify-end">
                  <button
                    onClick={() => setSuggestionsDismissed(false)}
                    className="h-7 px-3 text-[10px] font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back to suggestions
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder={isLoading ? "Agent is thinking..." : "Tell the agent what to do..."}
                  disabled={isLoading}
                  className="flex-1 h-10 px-4 text-sm bg-secondary border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-2">
                <AlertTriangle className="h-3 w-3 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">
                  Trades execute on-chain via Shield wallet. Agent validates against real-time prices.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </WalletGate>
  );
};

export default Agent;
