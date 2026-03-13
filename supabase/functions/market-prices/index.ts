import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type PriceRow = {
  price: number;
  change24h: number;
};

type PriceMap = Record<string, PriceRow>;

type CoinGeckoPriceResponse = {
  bitcoin?: { usd?: number; usd_24h_change?: number };
  ethereum?: { usd?: number; usd_24h_change?: number };
  aleo?: { usd?: number; usd_24h_change?: number };
  solana?: { usd?: number; usd_24h_change?: number };
};

type CryptoCompareAsset = {
  USD?: {
    PRICE?: number;
    CHANGEPCT24HOUR?: number;
  };
};

type CryptoCompareResponse = {
  RAW?: {
    BTC?: CryptoCompareAsset;
    ETH?: CryptoCompareAsset;
    ALEO?: CryptoCompareAsset;
    SOL?: CryptoCompareAsset;
  };
};

const DEFAULT_PRICES: PriceMap = {
  "BTC-USD": { price: 0, change24h: 0 },
  "ETH-USD": { price: 0, change24h: 0 },
  "ALEO-USD": { price: 0, change24h: 0 },
  "SOL-USD": { price: 0, change24h: 0 },
};

function coingeckoToPriceMap(data: CoinGeckoPriceResponse): PriceMap {
  return {
    "BTC-USD": {
      price: Number(data.bitcoin?.usd ?? 0),
      change24h: Number(data.bitcoin?.usd_24h_change ?? 0),
    },
    "ETH-USD": {
      price: Number(data.ethereum?.usd ?? 0),
      change24h: Number(data.ethereum?.usd_24h_change ?? 0),
    },
    "ALEO-USD": {
      price: Number(data.aleo?.usd ?? 0),
      change24h: Number(data.aleo?.usd_24h_change ?? 0),
    },
    "SOL-USD": {
      price: Number(data.solana?.usd ?? 0),
      change24h: Number(data.solana?.usd_24h_change ?? 0),
    },
  };
}

function cryptocompareToPriceMap(data: CryptoCompareResponse): PriceMap {
  return {
    "BTC-USD": {
      price: Number(data.RAW?.BTC?.USD?.PRICE ?? 0),
      change24h: Number(data.RAW?.BTC?.USD?.CHANGEPCT24HOUR ?? 0),
    },
    "ETH-USD": {
      price: Number(data.RAW?.ETH?.USD?.PRICE ?? 0),
      change24h: Number(data.RAW?.ETH?.USD?.CHANGEPCT24HOUR ?? 0),
    },
    "ALEO-USD": {
      price: Number(data.RAW?.ALEO?.USD?.PRICE ?? 0),
      change24h: Number(data.RAW?.ALEO?.USD?.CHANGEPCT24HOUR ?? 0),
    },
    "SOL-USD": {
      price: Number(data.RAW?.SOL?.USD?.PRICE ?? 0),
      change24h: Number(data.RAW?.SOL?.USD?.CHANGEPCT24HOUR ?? 0),
    },
  };
}

function hasUsablePrices(prices: PriceMap): boolean {
  return Object.values(prices).some((priceRow) => Number.isFinite(priceRow.price) && priceRow.price > 0);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,aleo,solana&vs_currencies=usd&include_24hr_change=true",
        {
          headers: {
            "User-Agent": "AutoPerp/1.0",
            Accept: "application/json",
          },
        },
      );

      if (res.ok) {
        const data = (await res.json()) as CoinGeckoPriceResponse;
        const prices = coingeckoToPriceMap(data);
        if (hasUsablePrices(prices)) {
          return new Response(JSON.stringify({ source: "coingecko", prices, ts: Date.now() }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (err) {
      console.warn("market-prices coingecko failed:", err);
    }

    try {
      const res = await fetch(
        "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,SOL,ALEO&tsyms=USD",
        {
          headers: {
            "User-Agent": "AutoPerp/1.0",
            Accept: "application/json",
          },
        },
      );

      if (res.ok) {
        const data = (await res.json()) as CryptoCompareResponse;
        const prices = cryptocompareToPriceMap(data);
        if (hasUsablePrices(prices)) {
          return new Response(JSON.stringify({ source: "cryptocompare", prices, ts: Date.now() }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    } catch (err) {
      console.warn("market-prices cryptocompare failed:", err);
    }

    return new Response(
      JSON.stringify({
        source: "none",
        prices: DEFAULT_PRICES,
        ts: Date.now(),
        error: "No price source available",
      }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("market-prices error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", prices: DEFAULT_PRICES, ts: Date.now() }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
