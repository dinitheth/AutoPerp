import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { Wallet, Shield, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";

interface WalletGateProps {
  children: React.ReactNode;
  pageName: string;
}

const WalletGate = ({ children, pageName }: WalletGateProps) => {
  const { connected } = useWallet();

  if (connected) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <motion.div
        className="max-w-md mx-auto text-center px-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-6">
          <Shield className="h-8 w-8 text-primary" />
        </div>

        <h2 className="text-xl font-bold text-foreground mb-2">
          Connect Your Wallet
        </h2>
        <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
          Connect your Shield wallet to access {pageName}. Position records are private on Aleo, while settlement transfers are publicly visible in the current path.
        </p>

        <ConnectWalletButton />

        <div className="mt-8 p-4 rounded-xl border border-border bg-card">
          <p className="text-[10px] text-muted-foreground mb-3 uppercase tracking-wider font-medium">
            Why Connect?
          </p>
          <div className="space-y-2.5 text-left">
            {[
              "Execute trades with private position records",
              "View your USDCx balance and positions",
              "Grant scoped agent permissions via AgentAuth",
            ].map((text) => (
              <div key={text} className="flex items-start gap-2">
                <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                <span className="text-xs text-muted-foreground">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default WalletGate;
