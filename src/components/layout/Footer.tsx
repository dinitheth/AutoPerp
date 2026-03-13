import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t border-border py-10">
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
                <span className="text-primary-foreground text-[10px] font-bold">AP</span>
              </div>
              <span className="text-sm font-semibold text-foreground">AutoPerp</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
              Privacy-aware perpetual trading with agent-assisted execution on Aleo.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-medium text-foreground mb-3 uppercase tracking-wider">Protocol</h4>
            <div className="flex flex-col gap-2">
              <Link to="/trade" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Trade</Link>
              <Link to="/pool" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Liquidity</Link>
              <Link to="/agent" className="text-xs text-muted-foreground hover:text-foreground transition-colors">AI Agent</Link>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-medium text-foreground mb-3 uppercase tracking-wider">Resources</h4>
            <div className="flex flex-col gap-2">
              <Link to="/docs" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Documentation</Link>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors">GitHub</a>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-medium text-foreground mb-3 uppercase tracking-wider">Network</h4>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Aleo Testnet</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-glow" />
                Operational
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            AutoPerp Protocol. Built on Aleo.
          </p>
          <p className="text-xs text-muted-foreground">
            Testnet only. Not financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
