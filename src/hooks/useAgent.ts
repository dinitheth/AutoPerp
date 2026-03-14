// AutoPerp Agent hook - assisted on-chain execution
import { useState, useCallback, useRef, useEffect } from "react";
import { callGemini, type GeminiMessage } from "@/lib/gemini";
import type { MarketPrice } from "@/hooks/usePrices";

export interface TradeParams {
  market: string;
  direction: "long" | "short";
  collateral: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  showTradeForm?: boolean;
  preselectedMarket?: string;
  action?: {
    type: string;
    details: string;
    status: "pending" | "executed" | "failed";
    tradeParams?: TradeParams;
  };
}

interface AgentContext {
  prices: MarketPrice[];
  usdcxBalance: string | null;
  creditsBalance: string | null;
  walletConnected: boolean;
  walletAddress: string | null;
}

function buildSystemPrompt(ctx: AgentContext): string {
  const priceList = ctx.prices
    .map(
      (price) =>
        `${price.symbol}: $${price.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (24h: ${price.positive ? "+" : ""}${price.change24h.toFixed(2)}%)`,
    )
    .join("\n");

  return `You are AutoPerp Agent, an AI trading assistant for AutoPerp, a privacy-focused perpetual futures DEX on Aleo blockchain.

## YOUR CAPABILITIES
- Open leveraged positions on supported markets via user-approved Shield transactions
- Configure stop-loss (SL) and take-profit (TP) parameters on position open
- Track real-time market prices and user balances

## AVAILABLE MARKETS AND REAL-TIME PRICES
${priceList}

## SUPPORTED MARKETS
Only these pairs are tradable: BTC-USD, ETH-USD, ALEO-USD

## USER WALLET STATUS
Connected: ${ctx.walletConnected ? "Yes" : "No"}
${ctx.walletConnected ? `Address: ${ctx.walletAddress}` : ""}
USDCx Balance: ${ctx.usdcxBalance ?? "Not available (wallet not connected)"}
Aleo Credits: ${ctx.creditsBalance ?? "Not available"}

## PLATFORM RULES
- Collateral currency: USDCx (test_usdcx_stablecoin.aleo public balance)
- Supported leverage: 1x, 2x, 5x, 10x, 25x, 50x
- Trading fee: 0.06%
- Position records are private, while settlement transfers/mappings are publicly observable
- AgentAuth permission primitives are deployed; full autonomous execution is in progress
- Minimum collateral: 1 USDCx
- Testnet only
- Trades are executed on-chain via the selected core program (Public: autoperp_core_v5.aleo, Private: autoperp_core_private_v2.aleo)
- Do not claim you can provide full account-level PnL or portfolio risk summaries from private records.

## CRITICAL VALIDATION RULES
1. Wallet must be connected. If not, tell the user to connect Shield wallet first.
2. The user's USDCx balance must cover the collateral amount. Current balance is ${ctx.usdcxBalance ?? "unknown"} USDCx. If collateral exceeds balance, reject the order immediately.
3. Market must be one of BTC-USD, ETH-USD, ALEO-USD.
4. For longs: SL < entry and TP > entry. For shorts: SL > entry and TP < entry.
5. Liquidation check: LONG uses entry * (1 - 0.9 / leverage). SHORT uses entry * (1 + 0.9 / leverage).
6. Warn about high liquidation risk for leverage >= 25x.
7. If market price is unavailable, tell the user prices are still loading.
8. If balance is 0.00 or unknown, tell the user you cannot verify available collateral.

## WHEN USER REQUEST IS MISSING INFO
When the user wants to open a position but has not provided all details, respond briefly and include [TRADE_SETUP] at the end. If the user mentioned a specific market, also include [MARKET:BTC-USD], [MARKET:ETH-USD], or [MARKET:ALEO-USD].

## ORDER CONFIRMATION FORMAT
When all validations pass, present the order like this:

I'll open the following position for you:

**[MARKET] [DIRECTION]**
- Collateral: [amount] USDCx
- Leverage: [X]x
- Position Size: $[collateral * leverage]
- Entry Price: ~$[current price]
- Stop Loss: $[price]
- Take Profit: $[price]
- Liquidation Price: ~$[calculated]
- Fee: $[calculated]
- Risk Level: [Low/Medium/High/Very High]

Shall I execute this trade?

## RESPONSE STYLE
- Be concise and professional
- Use real numbers from the price feed
- Always show risk level
- Reference actual USDCx balance`;
}

function extractTradeParams(
  response: string,
): AgentMessage["action"] extends { tradeParams?: infer T } ? T | undefined : undefined {
  try {
    const marketMatch = response.match(/\*\*(BTC-USD|ETH-USD|ALEO-USD)\s+(LONG|SHORT|Long|Short)\*\*/i);
    if (!marketMatch) return undefined;

    const market = marketMatch[1];
    const direction = marketMatch[2].toLowerCase() as "long" | "short";

    const collateralMatch = response.match(/Collateral:\s*(\d+(?:\.\d+)?)\s*USDCx/i);
    const collateral = collateralMatch ? parseFloat(collateralMatch[1]) : undefined;

    const leverageMatch = response.match(/Leverage:\s*(\d+)x/i);
    const leverage = leverageMatch ? parseInt(leverageMatch[1], 10) : undefined;

    const slMatch = response.match(/Stop Loss:\s*\$?([\d,]+(?:\.\d+)?)/i);
    const tpMatch = response.match(/Take Profit:\s*\$?([\d,]+(?:\.\d+)?)/i);

    if (!collateral || !leverage) return undefined;

    return {
      market,
      direction,
      collateral,
      leverage,
      stopLoss: slMatch ? parseFloat(slMatch[1].replace(/,/g, "")) : undefined,
      takeProfit: tpMatch ? parseFloat(tpMatch[1].replace(/,/g, "")) : undefined,
    };
  } catch {
    return undefined;
  }
}

function buildWelcomeMessage(walletConnected: boolean, usdcxBalance: string | null): string {
  if (!walletConnected) {
    return "Welcome to AutoPerp Agent. Please connect your Shield wallet first so I can check your balance and execute trades on-chain.";
  }
  const balance = usdcxBalance && usdcxBalance !== "0.00" ? usdcxBalance : usdcxBalance ?? "loading...";
  return `Connected to AutoPerp Agent. Your USDCx balance is ${balance}. I can help set up and submit on-chain trades, configure SL/TP, and track real-time market prices and balances. What would you like to do?`;
}

function classifyUserIntent(input: string): {
  isOpenTradeIntent: boolean;
  isBalanceIntent: boolean;
  isSltpGuidanceIntent: boolean;
  market?: "BTC-USD" | "ETH-USD" | "ALEO-USD";
} {
  const text = input.toLowerCase();
  const hasOpenVerb = /(open|place|execute|submit|enter|buy|sell|go\s+long|go\s+short|\blong\b|\bshort\b)/.test(text);
  const hasTradeParam = /(x\b|leverage|collateral|usdcx|stop\s*loss|take\s*profit|tp\b|sl\b|market)/.test(text);
  const isBalanceIntent = /(balance|available|wallet|how much can i trade|max(?:imum)?\s+(?:position|trade)|buying power)/.test(text);
  const isSltpGuidanceIntent =
    /(stop\s*[- ]?loss|take\s*[- ]?profit|sl\/?tp|\bsl\b|\btp\b)/.test(text) &&
    /(help|suggest|recommend|advice|set|what should)/.test(text) &&
    !hasOpenVerb;
  const btc = /(btc\s*[-/]?\s*usd|btc)/.test(text);
  const eth = /(eth\s*[-/]?\s*usd|eth)/.test(text);
  const aleo = /(aleo\s*[-/]?\s*usd|aleo)/.test(text);

  let market: "BTC-USD" | "ETH-USD" | "ALEO-USD" | undefined;
  if (btc) market = "BTC-USD";
  else if (eth) market = "ETH-USD";
  else if (aleo) market = "ALEO-USD";

  return {
    isOpenTradeIntent: hasOpenVerb && !isBalanceIntent && !isSltpGuidanceIntent && (hasTradeParam || Boolean(market)),
    isBalanceIntent,
    isSltpGuidanceIntent,
    market,
  };
}

export function useAgent(ctx: AgentContext) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const historyRef = useRef<GeminiMessage[]>([]);
  const { walletConnected, usdcxBalance, creditsBalance, prices } = ctx;

  useEffect(() => {
    const welcomeContent = buildWelcomeMessage(walletConnected, usdcxBalance);
    const welcomeMsg: AgentMessage = {
      id: "welcome",
      role: "agent",
      content: welcomeContent,
      timestamp: new Date(),
    };

    setMessages((prev) => {
      if (prev.length === 0) return [welcomeMsg];
      if (prev[0]?.id === "welcome" && prev.length === 1) return [welcomeMsg];
      if (prev[0]?.id === "welcome") return [welcomeMsg, ...prev.slice(1)];
      return prev;
    });
  }, [walletConnected, usdcxBalance]);

  const sendMessage = useCallback(
    async (input: string) => {
      const userIntent = classifyUserIntent(input);

      const userMsg: AgentMessage = {
        id: Date.now().toString(),
        role: "user",
        content: input,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      historyRef.current.push({ role: "user", parts: [{ text: input }] });

      const systemPrompt = buildSystemPrompt(ctx);
      const response = await callGemini(historyRef.current, systemPrompt);

      historyRef.current.push({ role: "model", parts: [{ text: response }] });

      let action: AgentMessage["action"] | undefined;
      const tradeParams = extractTradeParams(response);
      if (
        userIntent.isOpenTradeIntent &&
        (
          tradeParams ||
          response.includes("Shall I execute") ||
          response.includes("execute this trade") ||
          response.includes("Confirm to proceed")
        )
      ) {
        const lines = response
          .split("\n")
          .filter((line) => line.trim().startsWith("-") || line.trim().startsWith("*"));
        const details = lines.map((line) => line.trim().replace(/^[-*]\s*/, "")).join(" | ");

        action = {
          type: "OPEN_POSITION",
          details: details || "Review order details above",
          status: "pending",
          tradeParams: tradeParams ?? undefined,
        };
      }

      let showTradeForm = false;
      let preselectedMarket: string | undefined;
      let cleanContent = response;

      if (userIntent.isOpenTradeIntent) {
        showTradeForm = true;
        preselectedMarket = userIntent.market;
        cleanContent = preselectedMarket
          ? `Set up your ${preselectedMarket} position below.`
          : "Set up your position below.";
        action = undefined;
      }

      if (response.includes("[TRADE_SETUP]")) {
        if (userIntent.isOpenTradeIntent) {
          showTradeForm = true;
          cleanContent = response.replace(/\[TRADE_SETUP\]/g, "").trim();
          const marketTag = response.match(/\[MARKET:(BTC-USD|ETH-USD|ALEO-USD)\]/);
          if (marketTag) {
            preselectedMarket = marketTag[1];
            cleanContent = cleanContent.replace(/\[MARKET:[A-Z-]+\]/g, "").trim();
          }
          cleanContent = preselectedMarket
            ? `Set up your ${preselectedMarket} position below.`
            : "Set up your position below.";
        } else {
          cleanContent = response
            .replace(/\[TRADE_SETUP\]/g, "")
            .replace(/\[MARKET:[A-Z-]+\]/g, "")
            .trim();
        }
      }

      const agentMsg: AgentMessage = {
        id: (Date.now() + 1).toString(),
        role: "agent",
        content: cleanContent,
        timestamp: new Date(),
        showTradeForm,
        preselectedMarket,
        action,
      };

      setMessages((prev) => [...prev, agentMsg]);
      setIsLoading(false);
    },
    [ctx],
  );

  const getPendingTradeParams = useCallback(
    (msgId: string) => {
      const msg = messages.find((message) => message.id === msgId);
      return msg?.action?.tradeParams ?? null;
    },
    [messages],
  );

  const markActionExecuted = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === msgId && message.action
          ? { ...message, action: { ...message.action, status: "executed" as const } }
          : message,
      ),
    );
  }, []);

  const rejectAction = useCallback((msgId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === msgId && message.action
          ? { ...message, action: { ...message.action, status: "failed" as const } }
          : message,
      ),
    );
  }, []);

  const queueOpenPosition = useCallback(
    (params: TradeParams, summaryLine: string, details: string) => {
      const now = Date.now();
      const userMsg: AgentMessage = {
        id: String(now),
        role: "user",
        content: summaryLine,
        timestamp: new Date(),
      };
      const agentMsg: AgentMessage = {
        id: String(now + 1),
        role: "agent",
        content:
          "I'll open the following position for you:\n\n" +
          `**${params.market} ${params.direction.toUpperCase()}**\n` +
          `- Collateral: ${params.collateral} USDCx\n` +
          `- Leverage: ${params.leverage}x\n` +
          (params.stopLoss ? `- Stop Loss: $${params.stopLoss}\n` : "- Stop Loss: Not set\n") +
          (params.takeProfit ? `- Take Profit: $${params.takeProfit}\n` : "- Take Profit: Not set\n") +
          "\nShall I execute this trade?",
        timestamp: new Date(),
        action: {
          type: "OPEN_POSITION",
          details,
          status: "pending",
          tradeParams: params,
        },
      };

      setMessages((prev) => [...prev, userMsg, agentMsg]);
      return agentMsg.id;
    },
    [],
  );

  const appendAgentMessage = useCallback((content: string) => {
    const now = Date.now();
    const agentMsg: AgentMessage = {
      id: String(now),
      role: "agent",
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, agentMsg]);
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    queueOpenPosition,
    appendAgentMessage,
    getPendingTradeParams,
    markActionExecuted,
    rejectAction,
  };
}

