import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  HelpCircle,
  Loader2,
  Send,
  Shield,
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
import { useAleoTransaction, PROGRAMS, MARKET_IDS, toPrice, toUsdcx } from "@/hooks/useAleoTransaction";
import { addOrder, addTradeEvent, newId } from "@/lib/portfolioStore";
import {
  LEGACY_SETTLEMENT_MESSAGE,
  REAL_SETTLEMENT_AVAILABLE,
  STRICT_PRIVATE_CORE_ACTIVE,
} from "@/lib/protocol";
import { findPoolStateRecord, findVaultRecord } from "@/lib/privateCoreRecords";
import { isProgramNotAllowedError, requestProgramRecords } from "@/lib/walletRecords";
import { toast } from "sonner";

const suggestions = [
  {
    icon: TrendingUp,
    label: "Open a position",
    message: "I want to open a leveraged position. What markets are available?",
  },
  {
    icon: BarChart3,
    label: "Check my portfolio",
    message: "Show me my current portfolio risk analysis and PnL",
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const lastTradeStatusRef = useRef<"pending" | "executed" | "failed" | null>(null);
  const [autoExecute, setAutoExecute] = useState(() => {
    const raw = localStorage.getItem("autoperp:agent:autoExecute");
    return raw ? raw === "true" : true;
  });

  const { prices, getPrice } = usePrices();
  const { usdcxBalance, vaultBalance, creditsBalance, refetch: refetchBalance } = useUsdcxBalance();
  const { connected, address, requestRecords, connect, disconnect } = useWallet();
  const { execute, loading: txLoading, getLastError } = useAleoTransaction();

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

  useEffect(() => {
    localStorage.setItem("autoperp:agent:autoExecute", String(autoExecute));
  }, [autoExecute]);

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

    const directionVal = tradeParams.direction === "long" ? "0u8" : "1u8";
    const sl = tradeParams.stopLoss ? toPrice(tradeParams.stopLoss) : "0u64";
    const tp = tradeParams.takeProfit ? toPrice(tradeParams.takeProfit) : "0u64";
    const paramsInput = `{ market_id: ${marketId}, direction: ${directionVal}, collateral: ${toUsdcx(tradeParams.collateral)}, leverage: ${tradeParams.leverage}u64, entry_price: ${toPrice(currentPrice)}, stop_loss: ${sl}, take_profit: ${tp} }`;
    let result = null;

    if (STRICT_PRIVATE_CORE_ACTIVE) {
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
        const pool = findPoolStateRecord(records, owner, marketId);
        return { vault, pool };
      };

      let vault: ReturnType<typeof findVaultRecord>;
      let pool: ReturnType<typeof findPoolStateRecord>;
      try {
        ({ vault, pool } = await loadState());
      } catch (error) {
        const err = isProgramNotAllowedError(error)
          ? "Shield denied record access for this program. Reconnect wallet and approve permissions."
          : "Could not load private records from Shield.";
        rejectAction(msgId);
        appendAgentMessage(err);
        toast.error(err);
        return;
      }

      if (!vault) {
        const created = await execute(PROGRAMS.CORE, "create_vault", ["0u64"]);
        if (!created) {
          rejectAction(msgId);
          appendAgentMessage("Private vault initialization failed.");
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!pool) {
        const bootstrapped = await execute(PROGRAMS.CORE, "bootstrap_pool", [marketId, "0u64"]);
        if (!bootstrapped) {
          rejectAction(msgId);
          appendAgentMessage("Private pool initialization failed.");
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!vault || !pool) {
        rejectAction(msgId);
        appendAgentMessage("Could not load private state records for trade execution.");
        return;
      }

      const collateralMicro = Math.floor(tradeParams.collateral * 1_000_000);
      const neededTopUp = Math.max(0, collateralMicro - vault.balanceMicro);

      if (neededTopUp > 0) {
        toast.info(`Funding private vault by ${(neededTopUp / 1_000_000).toFixed(6)} units...`);
        const funded = await execute(PROGRAMS.CORE, "deposit_collateral", [vault.input, `${neededTopUp}u64`]);
        if (!funded) {
          const err = (getLastError() ?? "Unknown error").trim();
          rejectAction(msgId);
          appendAgentMessage(`Private vault funding failed: ${err}`);
          return;
        }
        ({ vault, pool } = await loadState());
      }

      if (!vault || !pool) {
        rejectAction(msgId);
        appendAgentMessage("Could not refresh private state after vault funding.");
        return;
      }

      toast.info("Opening private position on Aleo - approve in Shield...");
      result = await execute(PROGRAMS.CORE, "open_position", [vault.input, pool.input, paramsInput, address]);
    } else {
      const walletBal = parseFloat(usdcxBalance ?? "0");
      const vaultBal = parseFloat(vaultBalance ?? "0");
      const neededDeposit = Math.max(0, tradeParams.collateral - vaultBal);

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
        toast.info(`Locking ${neededDeposit.toFixed(2)} USDCx as collateral - approve in Shield...`);
        const depositResult = await execute(PROGRAMS.CORE, "deposit_collateral", [toUsdcx(neededDeposit)]);
        if (!depositResult) {
          const err = (getLastError() ?? "Unknown error").trim();
          rejectAction(msgId);
          appendAgentMessage(`Transaction failed while locking collateral: ${err}`);
          return;
        }
        setTimeout(() => refetchBalance(), 2500);
        setTimeout(() => refetchBalance(), 8000);
      }

      toast.info("Opening position on Aleo - approve in Shield...");
      result = await execute(PROGRAMS.CORE, "open_position", [paramsInput, address]);
    }

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
      addTradeEvent({
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
      setTimeout(() => window.dispatchEvent(new Event("autoperp:positions-changed")), 2500);

      appendAgentMessage(
        `Trade executed on-chain.\n\nAleo TX Hash: \`${txHash}\`\n\n[View on Aleo Explorer](${explorerUrl})\n\nYour position is now live.`,
      );
      toast.success("Transaction confirmed on Aleo blockchain!", {
        description: `TX: ${txHash.slice(0, 20)}...`,
        action: {
          label: "View on Explorer",
          onClick: () => window.open(explorerUrl, "_blank"),
        },
      });
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
    vaultBalance,
  ]);

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
    if (autoExecute) {
      // Run inside the same user flow that submitted the form (more reliable for wallet popups).
      void handleConfirm(actionMsgId, params);
    }
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
                  Powered by Gemini AI - assisted on-chain execution - AgentAuth permission primitives
                </p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                {connected && usdcxBalance && (
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                    {usdcxBalance} USDCx
                  </span>
                )}
                <div className="hidden sm:flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Auto Execute</span>
                  <button
                    onClick={() => setAutoExecute((v) => !v)}
                    className={cn(
                      "w-8 h-[18px] rounded-full transition-colors relative",
                      autoExecute ? "bg-primary" : "bg-secondary",
                    )}
                    aria-label="Toggle auto execute"
                  >
                    <span
                      className={cn(
                        "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-foreground transition-transform",
                        autoExecute ? "left-[16px]" : "left-[2px]",
                      )}
                    />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-success" />
                  <span className="text-[10px] text-success">Privacy-aware mode</span>
                </div>
              </div>
            </div>
          </div>

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
                        {msg.action.status === "pending" && (
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
