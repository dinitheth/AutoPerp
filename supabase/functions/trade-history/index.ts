import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NEON_URL = Deno.env.get("NEON_DATABASE_URL") ?? "";

interface TradeEventPayload {
  id: string;
  wallet_hash: string; // SHA-256 hashed wallet address for privacy
  event_type: "OPEN" | "CLOSE";
  market: string;
  side: "long" | "short";
  collateral_usdcx: number;
  leverage: number;
  entry_price: number;
  exit_price?: number | null;
  pnl_usd?: number | null;
  tx_id: string;
}

async function query(sql: string, params: unknown[] = []): Promise<unknown[]> {
  // Neon serverless HTTP query endpoint
  const url = NEON_URL.replace(/^postgres(ql)?:\/\//, "https://").split("?")[0];
  // Extract host from the connection string for the HTTP SQL API
  const match = NEON_URL.match(/@([^/]+)\//);
  if (!match) throw new Error("Cannot parse Neon host from DATABASE_URL");
  const host = match[1];

  const userPassMatch = NEON_URL.match(/:\/\/([^:]+):([^@]+)@/);
  if (!userPassMatch) throw new Error("Cannot parse Neon credentials");
  const [, user, password] = userPassMatch;

  const dbMatch = NEON_URL.match(/\/([^?]+)/);
  const dbName = dbMatch ? dbMatch[1].split("/").pop() : "neondb";

  const apiUrl = `https://${host}/sql`;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": NEON_URL,
    },
    body: JSON.stringify({ query: sql, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon query failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.rows ?? data ?? [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!NEON_URL) {
    return new Response(
      JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "save") {
      const ev = body.event as TradeEventPayload;
      if (!ev?.id || !ev?.wallet_hash || !ev?.tx_id) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      await query(
        `INSERT INTO trade_events (id, wallet_address, event_type, market, side, collateral_usdcx, leverage, entry_price, exit_price, pnl_usd, tx_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          ev.id,
          ev.wallet_hash,
          ev.event_type,
          ev.market,
          ev.side,
          ev.collateral_usdcx,
          ev.leverage,
          ev.entry_price,
          ev.exit_price ?? null,
          ev.pnl_usd ?? null,
          ev.tx_id,
        ],
      );

      return new Response(
        JSON.stringify({ ok: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "load") {
      const walletHash = body.wallet_hash as string;
      if (!walletHash) {
        return new Response(
          JSON.stringify({ error: "Missing wallet_hash" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const rows = await query(
        `SELECT id, wallet_address, event_type, market, side, collateral_usdcx, leverage, entry_price, exit_price, pnl_usd, tx_id, created_at
         FROM trade_events
         WHERE wallet_address = $1
         ORDER BY created_at DESC
         LIMIT 500`,
        [walletHash],
      );

      return new Response(
        JSON.stringify({ trades: rows }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("trade-history error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
