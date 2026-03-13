import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { PROGRAMS } from "@/lib/protocol";
import { PRIVATE_CORE_PROGRAM, PUBLIC_CORE_PROGRAM } from "@/lib/protocol";
import { getWalletReconnectEnabled, setWalletReconnectEnabled } from "@/lib/walletSession";

interface WalletProviderProps {
  children: ReactNode;
}

const WalletSessionRestore = () => {
  const attemptedRef = useRef(false);
  const { wallet, wallets, connected, connecting, connect, selectWallet } = useWallet();

  useEffect(() => {
    if (attemptedRef.current) return;
    if (!getWalletReconnectEnabled()) return;
    if (connected || connecting) return;

    const shieldWallet = wallets.find(({ adapter }) =>
      String(adapter.name).toLowerCase().includes("shield"),
    );
    if (!shieldWallet) return;

    attemptedRef.current = true;

    (async () => {
      try {
        if (!wallet || String(wallet.adapter.name) !== String(shieldWallet.adapter.name)) {
          selectWallet(shieldWallet.adapter.name);
        }
        await connect(Network.TESTNET);
        setWalletReconnectEnabled(true);
      } catch {
        // Don't loop prompts on failure/rejection.
      }
    })();
  }, [wallet, wallets, connected, connecting, connect, selectWallet]);

  return null;
};

const WalletProvider = ({ children }: WalletProviderProps) => {
  const wallets = useMemo(() => [new ShieldWalletAdapter()], []);

  return (
    <AleoWalletProvider
      wallets={wallets}
      autoConnect={false}
      localStorageKey="autoperp:wallet"
      network={Network.TESTNET}
      decryptPermission={DecryptPermission.UponRequest}
      programs={[
        PROGRAMS.CORE,
        PRIVATE_CORE_PROGRAM,
        PUBLIC_CORE_PROGRAM,
        PROGRAMS.POOL,
        PROGRAMS.AGENT,
        PROGRAMS.ORACLE,
        PROGRAMS.USDCX,
        "credits.aleo",
      ]}
      onError={(error) => console.error("Shield wallet error:", error)}
    >
      <WalletSessionRestore />
      {children}
    </AleoWalletProvider>
  );
};

export default WalletProvider;
