import { motion } from "framer-motion";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `AutoPerp is a privacy-first perpetual DEX on Aleo. All positions settle against real USDCx (test_usdcx_stablecoin.aleo). Oracle prices are validated on-chain via cross-program reads from autoperp_oracle_v2.aleo. Funding rates are computed by the oracle and applied by core programs during position close.`,
  },
  {
    id: "oracle-integration",
    title: "Oracle Integration (Cross-Program Reads)",
    content: `Both core programs read prices and funding rates directly from autoperp_oracle_v2.aleo via cross-program external storage access inside their finalize (final {}) blocks.

open_position (both public and private core):
  - Reads: Mapping::get(autoperp_oracle_v2.aleo::prices, market_id)
  - Validates user-supplied entry_price is within 1% divergence of the oracle price
  - Assertion failure rejects the transaction if the price is stale or manipulated

close_position (both public and private core):
  - Reads: Mapping::get(autoperp_oracle_v2.aleo::prices, market_id) — validates close price
  - Reads: Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_rates, market_id, 0u64)
  - Reads: Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_direction, market_id, 0u8)
  - Computes funding_amount = (size * funding_rate) / 1_000_000
  - Adjusts pool_balance based on whether the position pays or receives funding

Note: Aleo's architecture requires that mapping reads happen asynchronously in the final {} block. The user-supplied price is the execution-scope input, and the oracle assertion in finalize guarantees it cannot diverge beyond 1% from the on-chain oracle price. This is the only possible pattern for cross-program price validation in snarkVM.`,
  },
  {
    id: "funding-rates",
    title: "Funding Rate Application",
    content: `Funding rates flow end-to-end:

1. Oracle Computation: autoperp_oracle_v2.aleo stores computed funding rates in the funding_rates mapping and direction in funding_direction

2. Core Program Application: During close_position, both autoperp_core_v9.aleo and autoperp_core_private_v9.aleo read funding_rates and funding_direction from the oracle via cross-program mapping access

3. Settlement Math: funding_amount = (position_size * funding_rate) / 1_000_000. If position direction matches fund_direction, the position pays funding (pool gains). Otherwise, the position receives funding (pool pays)

4. UI Transparency: The Trade page PriceBar displays live funding rates read from on-chain oracle mappings. The Positions table header shows "Est. PnL (± Funding)" to signal that funding is applied during settlement`,
  },
  {
    id: "agent-auth",
    title: "AgentAuth Integration",
    content: `autoperp_agent_v3.aleo implements scoped, delegated execution with:

- Bitmask Permissions: LIQUIDATE (1), CLOSE (2), ADJUST (4) — combinable via bitwise OR
- Block-Height Expiry: Authorizations expire after a specified block height
- Single-Use Enforcement: Each AgentAuth record is consumed on execution, preventing replay

Frontend Integration (Agent Page):
- grant_auth: Creates an AgentAuth record with scoped permissions, called via useAgentAuth hook
- execute_agent_action: The AI chatbot recognizes "simulate agent" / "test agent" intents and renders an EXECUTE_AGENT_ACTION UI. Users paste their encrypted AgentAuth record, and the frontend calls autoperp_agent_v3.aleo::execute_agent_action on-chain
- revoke_auth: Cancels an active authorization by consuming the record
- On-chain execution produces an immutable ExecutionReceipt record

The Agent page header shows active authorizations, execution receipts, and the agent's on-chain execution count from the agent_executions mapping.`,
  },
  {
    id: "privacy",
    title: "Privacy Model & Private Token Transfers",
    content: `Private Mode (autoperp_core_private_v9.aleo):

- Positions: Stored as encrypted PositionRecord records — invisible on explorer
- Vault: TraderVault record holds private balance
- LP Tokens: Private LPToken records for pool deposits

Private Token Transfers (closing privacy gap):
- Withdrawals use transfer_public_to_private: Creates a private USDCx Token record, so withdrawal amounts are NOT visible on explorer
- Close Position payouts use transfer_public_to_private: PnL settlements are shielded
- LP Withdrawals use transfer_public_to_private: LP redemptions are shielded
- Fee Claims use transfer_public_to_private: Fee payouts are shielded
- Deposits use transfer_public_as_signer: Required because test_usdcx's transfer_private_to_public requires Merkle freeze-list proofs that cannot be generated client-side

Scalability Fix (Wave 4 Feedback):
- The single-owner PoolState record has been completely removed
- Pool state now uses shared public mappings: pool_balance, pool_deposits, pool_shares, pool_fees, open_interest, position_count
- Multiple traders can interact concurrently without record contention`,
  },
  {
    id: "programs",
    title: "Deployed Programs (Testnet)",
    content: `autoperp_core_v9.aleo — Public settlement: trading, collateral, liquidity, fees. Cross-program oracle price validation and funding rate application in close_position.

autoperp_core_private_v9.aleo — Private settlement: encrypted position records, private vault, shared pool mappings. Private token transfers via transfer_public_to_private for withdrawals and payouts.

autoperp_agent_v3.aleo — Delegated agent execution: grant_auth (bitmask permissions, block-height expiry), execute_agent_action (single-use consumption), revoke_auth, liquidate_position.

autoperp_oracle_v2.aleo — On-chain oracle: TWAP prices, funding rates, funding direction. Read by both core programs via cross-program Mapping::get.

test_usdcx_stablecoin.aleo — ARC-20 stablecoin with freeze-list compliance, used for all USDCx settlement.`,
  },
  {
    id: "markets",
    title: "Markets and Precision",
    content: `Supported markets use fixed IDs: BTC-USD = 0, ETH-USD = 1.

USDCx uses 6 decimals. Prices use 8 decimals. The protocol fee is 0.06% of notional.`,
  },
  {
    id: "lp-yield",
    title: "Liquidity Pools",
    content: `AutoPerp has one pool per market (BTC-USD = 0, ETH-USD = 1).

LPs deposit USDCx and receive LP shares. Protocol fees from trader positions accrue to the pool.

Fee formula: fee = (notional * 6) / 10000 (0.06%)
Estimated Claimable = (your_shares * total_pool_fees) / total_pool_shares

Public mode: LP accounting and fee claims are public USDCx transfers.
Private mode: LP ownership is private records. Fee claims and withdrawals use transfer_public_to_private for shielded payouts.`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    content: `If positions look empty in Portfolio:
- Refresh wallet records from Trade > Positions > Refresh
- Ensure Shield wallet stays connected to the same account

If close position shows "Transaction Rejected":
- Retry once after mark price updates
- Keep Shield wallet unlocked during proof generation
- Ensure you are closing from the owner wallet that opened the position
- Common reject causes are stale/consumed position records, owner mismatch, or oracle price divergence > 1%`,
  },
];

const Docs = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-24 pb-20">
        <div className="container max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Documentation</h1>
            <p className="text-sm text-muted-foreground mb-10">
              Current protocol notes for the redeployable AutoPerp settlement architecture.
            </p>

            <nav className="mb-10 p-4 rounded-xl border border-border bg-card">
              <p className="text-xs font-medium text-foreground mb-2 uppercase tracking-wider">Contents</p>
              <div className="flex flex-col gap-1">
                {sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {s.title}
                  </a>
                ))}
              </div>
            </nav>

            <div className="space-y-12">
              {sections.map((section) => (
                <section key={section.id} id={section.id}>
                  <h2 className="text-lg font-semibold text-foreground mb-4 pb-2 border-b border-border">
                    {section.title}
                  </h2>
                  <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                    {section.content}
                  </div>
                </section>
              ))}
            </div>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Docs;
