import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

const MARKET_PAIRS = ["BTC-USD", "ETH-USD", "ALEO-USD"];

interface AgentMessageContentProps {
  content: string;
  isUser: boolean;
  onSelectMarket?: (market: string) => void;
}

/** Renders market pair names as clickable buttons in agent text */
function renderWithMarketButtons(
  text: string,
  onSelectMarket?: (market: string) => void
) {
  if (!onSelectMarket) return text;

  // Split text by market pair mentions
  const regex = new RegExp(`(${MARKET_PAIRS.join("|")})`, "g");
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (MARKET_PAIRS.includes(part)) {
      return (
        <button
          key={i}
          onClick={() => onSelectMarket(part)}
          className="inline-flex items-center px-1.5 py-0.5 mx-0.5 text-[11px] font-mono font-medium rounded-md bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors cursor-pointer"
        >
          {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const AgentMessageContent = ({ content, isUser, onSelectMarket }: AgentMessageContentProps) => {
  if (isUser) {
    return <p className="text-sm leading-relaxed whitespace-pre-line">{content}</p>;
  }

  return (
    <div className="text-sm leading-relaxed prose-agent">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="mb-2 last:mb-0">
              {typeof children === "string"
                ? renderWithMarketButtons(children, onSelectMarket)
                : Array.isArray(children)
                ? children.map((child, i) =>
                    typeof child === "string"
                      ? renderWithMarketButtons(child, onSelectMarket)
                      : child
                  )
                : children}
            </p>
          ),
          strong: ({ children }) => (
            <span className="font-semibold text-foreground">{children}</span>
          ),
          ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => (
            <li className="text-sm">
              {typeof children === "string"
                ? renderWithMarketButtons(children, onSelectMarket)
                : Array.isArray(children)
                ? children.map((child, i) =>
                    typeof child === "string"
                      ? renderWithMarketButtons(child, onSelectMarket)
                      : child
                  )
                : children}
            </li>
          ),
          code: ({ children }) => (
            <code className="text-[11px] bg-secondary/60 px-1.5 py-0.5 rounded font-mono break-all">
              {children}
            </code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 transition-colors"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <p className="font-semibold text-foreground mb-1">{children}</p>,
          h2: ({ children }) => <p className="font-semibold text-foreground mb-1">{children}</p>,
          h3: ({ children }) => <p className="font-semibold text-foreground mb-1">{children}</p>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default AgentMessageContent;
