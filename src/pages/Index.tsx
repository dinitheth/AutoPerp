import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Check, X } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

const comparisonData = [
  {
    feature: "Position Privacy",
    existing: "Fully public on-chain. Size, leverage, and liquidation price visible to everyone.",
    autoperp: "Encrypted as private Aleo records. Only position owner can view details.",
    existingSupported: false,
    autoperpSupported: true,
  },
  {
    feature: "Liquidation Mechanism",
    existing: "Relies on human liquidators who must manually trigger liquidations, causing delays.",
    autoperp: "Fully autonomous. AI agent monitors and executes liquidations in real-time.",
    existingSupported: false,
    autoperpSupported: true,
  },
  {
    feature: "Risk Management",
    existing: "Requires off-chain bots with full private key access for stop-loss and take-profit.",
    autoperp: "On-chain AgentAuth records with scoped, revocable permissions. No key exposure.",
    existingSupported: false,
    autoperpSupported: true,
  },
  {
    feature: "Front-Running Protection",
    existing: "Transparent order flow enables MEV extraction and sandwich attacks.",
    autoperp: "Zero-knowledge proofs hide order details until settlement is finalized.",
    existingSupported: false,
    autoperpSupported: true,
  },
  {
    feature: "LP Privacy",
    existing: "Individual LP sizes and entry points are publicly visible, enabling targeted attacks.",
    autoperp: "LP positions are private records. Only aggregate pool depth is public.",
    existingSupported: false,
    autoperpSupported: true,
  },
  {
    feature: "Delegated Execution",
    existing: "No native delegation. Third-party bots require full wallet access.",
    autoperp: "AgentAuth records grant scoped permissions with expiry and revocation.",
    existingSupported: false,
    autoperpSupported: true,
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero with background animation */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full"
            style={{
              background: "radial-gradient(circle, hsl(211 100% 50% / 0.08) 0%, transparent 70%)",
            }}
            animate={{
              x: [0, 40, -20, 0],
              y: [0, -30, 20, 0],
              scale: [1, 1.1, 0.95, 1],
            }}
            transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full"
            style={{
              background: "radial-gradient(circle, hsl(211 100% 50% / 0.05) 0%, transparent 70%)",
            }}
            animate={{
              x: [0, -30, 20, 0],
              y: [0, 40, -20, 0],
              scale: [1, 0.9, 1.1, 1],
            }}
            transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full"
            style={{
              background: "radial-gradient(circle, hsl(211 100% 50% / 0.03) 0%, transparent 60%)",
            }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* Grid overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: "linear-gradient(hsl(211 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(211 100% 50%) 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div className="container relative z-10">
          <motion.div
            className="max-w-3xl mx-auto text-center"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-xs text-muted-foreground mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Live on Aleo Testnet
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1] mb-6">
              Privacy-Focused Perpetuals.{" "}
              <span className="text-gradient-primary">Assisted On-Chain Execution.</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
              Trade perpetuals with private position records, transparent settlement, and progressive automation on Aleo testnet.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/trade"
                className="inline-flex items-center gap-2 h-12 px-8 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Launch App
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/docs"
                className="inline-flex items-center gap-2 h-12 px-8 text-sm font-medium rounded-xl border border-border text-foreground hover:bg-secondary transition-colors"
              >
                Read Documentation
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-border">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {[
              { label: "Programs Deployed", value: "Live" },
              { label: "Supported Markets", value: "3" },
              { label: "Network", value: "Testnet" },
              { label: "Liquidations Automated", value: "In Progress" },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                className="text-center"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * i }}
              >
                <p className="text-2xl md:text-3xl font-bold text-foreground font-mono">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-20 md:py-28">
        <div className="container">
          <motion.div
            className="max-w-2xl mx-auto text-center mb-14"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h2 className="text-2xl md:text-4xl font-bold text-foreground mb-4">
              How AutoPerp Compares
            </h2>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
              A direct comparison between existing perpetual DEXs and AutoPerp across
              the most critical dimensions of privacy, automation, and security.
            </p>
          </motion.div>

          {/* Desktop Table */}
          <motion.div
            className="hidden md:block max-w-5xl mx-auto rounded-2xl border border-border overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-card">
                  <th className="text-center text-xs font-semibold text-foreground uppercase tracking-wider px-6 py-4 w-[200px]">
                    Feature
                  </th>
                  <th className="text-center text-xs font-semibold text-destructive uppercase tracking-wider px-6 py-4">
                    Existing Perp DEXs
                  </th>
                  <th className="text-center text-xs font-semibold text-primary uppercase tracking-wider px-6 py-4">
                    AutoPerp
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, i) => (
                  <tr key={row.feature} className={`border-b border-border ${i % 2 === 0 ? "bg-background" : "bg-card/50"}`}>
                    <td className="px-6 py-5 text-sm font-medium text-foreground align-top">
                      {row.feature}
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="flex items-start gap-2">
                        <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground leading-relaxed">{row.existing}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-top">
                      <div className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                        <span className="text-sm text-muted-foreground leading-relaxed">{row.autoperp}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {comparisonData.map((row, i) => (
              <motion.div
                key={row.feature}
                className="rounded-xl border border-border bg-card p-5"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 * i }}
              >
                <h3 className="text-sm font-semibold text-foreground mb-3">{row.feature}</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <X className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-medium text-destructive">Existing DEXs</span>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{row.existing}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <div>
                      <span className="text-xs font-medium text-primary">AutoPerp</span>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{row.autoperp}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 md:py-28 border-t border-border">
        <div className="container">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
              Start Trading Privately
            </h2>
            <p className="text-sm text-muted-foreground mb-8">
              Connect your Shield Wallet and use a privacy-aware perpetuals experience
              with on-chain settlement and evolving automation.
            </p>
            <Link
              to="/trade"
              className="inline-flex items-center gap-2 h-11 px-6 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Launch App
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
