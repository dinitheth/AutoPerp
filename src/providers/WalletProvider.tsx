import { useMemo, type ReactNode } from "react";
import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { PROGRAMS } from "@/lib/protocol";

interface WalletProviderProps {
  children: ReactNode;
}

const WalletProvider = ({ children }: WalletProviderProps) => {
  const wallets = useMemo(() => [new ShieldWalletAdapter()], []);

  return (
    <AleoWalletProvider
      wallets={wallets}
      autoConnect={true}
      localStorageKey="autoperp:wallet"
      network={Network.TESTNET}
      decryptPermission={DecryptPermission.UponRequest}
      programs={[
        PROGRAMS.CORE,
        PROGRAMS.POOL,
        PROGRAMS.AGENT,
        PROGRAMS.ORACLE,
        PROGRAMS.USDCX,
        "credits.aleo",
      ]}
      onError={(error) => console.error("Shield wallet error:", error)}
    >
      {children}
    </AleoWalletProvider>
  );
};

export default WalletProvider;
