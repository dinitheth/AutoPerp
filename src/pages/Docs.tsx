import { motion } from "framer-motion";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

const sections = [
  {
    id: "overview",
    title: "Overview",
    content: `AutoPerp is a privacy-first perpetual DEX on Aleo. This version uses a unified settlement contract so trader collateral, LP liquidity, and fee payouts are all backed by the same real USDCx balance.`,
  },
  {
    id: "privacy",
    title: "Privacy Model",
    content: `Positions remain private Leo records. The protocol exposes public state such as open interest, pool balances, share totals, and oracle prices. LP ownership records are private, while USDCx deposit/withdraw settlement transfers are publicly visible on explorer in the current path.`,
  },
  {
    id: "settlement",
    title: "Settlement",
    content: `The active settlement path is autoperp_core_v5.aleo plus test_usdcx_stablecoin.aleo.

- deposit_collateral pulls real USDCx from the signer into the program
- open_position moves vault funds into the market pool balance
- close_position settles trader PnL back to the vault (winning trades are paid from pool balance)
- deposit_liquidity adds LP capital to the same market pool balance
- claim_fees and withdraw_liquidity pay out from that same contract`,
  },
  {
    id: "programs",
    title: "Programs",
    content: `autoperp_core_v5.aleo: trading, collateral, liquidity, fees, withdrawals

autoperp_agent_v2.aleo: scoped agent authorization and execution

autoperp_oracle.aleo: market price and risk data

autoperp_pool_v2.aleo: deprecated standalone helper retained for compatibility only`,
  },
  {
    id: "markets",
    title: "Markets and Precision",
    content: `Supported markets use fixed IDs: BTC-USD = 0, ETH-USD = 1, ALEO-USD = 2.

USDCx uses 6 decimals. Prices use 8 decimals. The protocol fee is 0.06% of notional.`,
  },
  {
    id: "ui",
    title: "Trade UI Notes",
    content: `The Trade form now keeps risk controls directly in the order box:

- Take Profit / Stop Loss inputs are always visible
- The old AI Agent toggle is removed from the Trade tab
- Available USDCx is shown beside Size (USDCx)

Agent-specific configuration remains on the dedicated Agent page.`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    content: `If positions look empty in Portfolio:

- Refresh wallet records from Trade > Positions > Refresh
- Ensure Shield wallet stays connected to the same account
- Portfolio uses cached rows first and then refreshes from chain in the background

If close position shows "Transaction Rejected" or "Unknown error":

- Retry once after mark price updates
- Keep Shield wallet unlocked during proof generation
- Ensure you are closing from the owner wallet that opened the position
- The app refreshes a fresh private position record before close to avoid stale-record rejection
- Common reject causes are stale/consumed position records, owner mismatch, or prover/network rejection under load
- If needed, refresh positions and try closing again`,
  },
  {
    id: "lp-yield",
    title: "LP Earnings",
    content: `Liquidity providers earn from protocol trading fees accrued in each market pool.

- Deposit USDCx into a selected pool (BTC/ETH/ALEO)
- Fees accumulate on-chain in pool_fees for that market
- Your estimated claimable fees use: (user_shares * total_pool_fees) / total_pool_shares
- Trader winner payouts on close are settled from the same pool balance`,
  },
  {
    id: "status",
    title: "Implementation Status",
    content: `Current feature maturity (testnet):

- Position Privacy: Private record state with public settlement transfers
- Liquidation Mechanism: Agent authorization contracts deployed; continuous automation runner in progress
- Risk Management: SL/TP configuration live on position open; deeper AgentAuth execution paths in progress
- Front-Running Protection: Reduced position-state exposure via private records; transfer-layer metadata remains public
- LP Privacy: Private LP ownership records with publicly visible settlement amounts
- Delegated Execution: On-chain permission primitives are live; production execution orchestration is in progress`,
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
