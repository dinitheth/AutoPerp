import { useEffect, useState } from "react";
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { Network } from "@provablehq/aleo-types";
import { WalletReadyState } from "@provablehq/aleo-wallet-standard";
import { Wallet, LogOut, Copy, Check, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ConnectWalletButton = ({ className }: { className?: string }) => {
  const {
    wallet,
    wallets,
    address,
    connect,
    disconnect,
    selectWallet,
    connecting,
    connected,
  } = useWallet();

  const [showDialog, setShowDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const shieldWallet = wallets.find(({ adapter }) =>
    String(adapter.name).toLowerCase().includes("shield")
  );

  const shieldInstalled =
    shieldWallet?.readyState === WalletReadyState.INSTALLED ||
    shieldWallet?.readyState === WalletReadyState.LOADABLE;

  useEffect(() => {
    if (
      shieldWallet &&
      (!wallet || String(wallet.adapter.name) !== String(shieldWallet.adapter.name))
    ) {
      selectWallet(shieldWallet.adapter.name);
    }
  }, [shieldWallet, wallet, selectWallet]);

  const truncatedAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  const handleConnect = async () => {
    if (!shieldWallet || !shieldInstalled) {
      window.open("https://aleo.org/shield/", "_blank");
      return;
    }

    try {
      if (!wallet || String(wallet.adapter.name) !== String(shieldWallet.adapter.name)) {
        selectWallet(shieldWallet.adapter.name);
      }
      await connect(Network.TESTNET);
    } catch (err) {
      console.error("Shield connection failed:", err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      setShowDialog(false);
    } catch (err) {
      console.error("Wallet disconnect failed:", err);
    }
  };

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (connected && address) {
    return (
      <>
        <button
          onClick={() => setShowDialog(true)}
          className={cn(
            "inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg bg-secondary border border-border text-foreground hover:bg-secondary/80 transition-colors",
            className
          )}
        >
          <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          {truncatedAddress}
        </button>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">Shield Wallet</DialogTitle>
              <DialogDescription className="text-xs">
                Connected to Aleo testnet
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-secondary border border-border">
                <p className="text-[10px] text-muted-foreground mb-1">Address</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-mono text-foreground flex-1 break-all">
                    {address}
                  </p>
                  <button
                    onClick={handleCopy}
                    className="p-1 rounded hover:bg-accent transition-colors"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
              </div>

              <a
                href={`https://testnet.explorer.provable.com/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 rounded-xl bg-secondary border border-border hover:bg-secondary/80 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-foreground">View on Explorer</span>
              </a>

              <button
                onClick={handleDisconnect}
                className="w-full flex items-center justify-center gap-2 h-9 text-xs font-medium rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className={cn(
        "inline-flex items-center gap-2 h-8 px-4 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50",
        className
      )}
    >
      <Wallet className="h-3.5 w-3.5" />
      {connecting ? "Connecting..." : shieldInstalled ? "Connect Shield" : "Install Shield"}
    </button>
  );
};

export default ConnectWalletButton;
