import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { ExternalLink } from "lucide-react";

const faucets = [
  {
    title: "Get Sepolia ETH",
    description: "Obtain testnet ETH on the Sepolia network via Thirdweb Faucet.",
    url: "https://thirdweb.com/sepolia",
    tag: "Ethereum",
  },
  {
    title: "Get Sepolia USDC",
    description: "Claim testnet USDC on Sepolia from the Circle faucet.",
    url: "https://faucet.circle.com",
    tag: "USDC",
  },
  {
    title: "Mint USDCx on Aleo",
    description: "Mint USDCx stablecoin tokens on the Aleo network via Circle xReserve.",
    url: "https://usdcx.aleo.dev/",
    tag: "USDCx",
  },
];

const Faucet = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container pt-20 pb-12">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold text-foreground mb-2">Faucets</h1>
          <p className="text-sm text-muted-foreground mb-8">
            Get testnet tokens to start trading on AutoPerp.
          </p>

          <div className="grid gap-3">
            {faucets.map((faucet) => (
              <a
                key={faucet.url}
                href={faucet.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:bg-secondary/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {faucet.title}
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                      {faucet.tag}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{faucet.description}</p>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0 ml-4" />
              </a>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Faucet;
