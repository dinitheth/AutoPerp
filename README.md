# AutoPerp

AutoPerp is a privacy-first perpetual trading protocol and application stack on Aleo.

It supports two core operating modes:

- Settlement mode (`autoperp_core_v5.aleo`): integrates with `test_usdcx_stablecoin.aleo` for real testnet settlement flows.
- Private mode (`autoperp_core_private_v2.aleo`): private record-based trading state with USDCx-backed collateral settlement.

## Mode Snapshots

Private - autoperp_core_private_v2.aleo

<a href="https://ibb.co/jkbVXXkK"><img src="https://i.ibb.co/5hGYHHhD/Private.jpg" alt="Private" border="0"></a>

Public - autoperp_core_v5.aleo

<a href="https://ibb.co/RpW122DN"><img src="https://i.ibb.co/wN1Tyyz7/Public.jpg" alt="Public" border="0"></a>

Update note: ~~`autoperp_core_private_v1.aleo`~~ is replaced by `autoperp_core_private_v2.aleo` with new features:

- USDCx-backed private collateral deposit/withdraw settlement
- improved private approval flow (4-step guided transactions)
- runtime mode support for Public/Private trading

## Product Summary

AutoPerp provides:

- Leveraged perpetual position lifecycle (open, manage, close)
- LP liquidity deposit/withdraw and fee accounting
- Agent authorization primitives for delegated actions
- Oracle-driven market pricing and risk references
- Web frontend with wallet-driven transaction execution

## Technology Stack

### Core

- Aleo smart contracts written in Leo
- React + TypeScript frontend
- Vite build system
- TailwindCSS UI system
- Shield wallet integration (`@provablehq/aleo-wallet-adaptor-*`)
- Supabase edge functions for AI chat and market data services

### Frontend Libraries

- React, React Router
- Framer Motion
- Sonner
- Radix UI primitives

### Backend/Services

- Supabase Functions (`agent-chat`, `market-prices`)
- Gemini API gateway (via Supabase function)

## Program Inventory

### Active Programs

- `autoperp_core_v5.aleo` (settlement-capable core)
- `autoperp_core_private_v2.aleo` (private record-based core)
- `autoperp_agent_v2.aleo` (AgentAuth and delegated execution receipts)
- `autoperp_oracle.aleo` (price, mark, funding state)
- `test_usdcx_stablecoin.aleo` (testnet USDCx token rails)

### Deprecated/Compatibility

- `autoperp_pool_v2.aleo` (legacy helper)

## Privacy Model

### Private Mode

`autoperp_core_private_v2.aleo` is a hybrid design:

- No public mappings for position/state accounting
- State transitions use private records (`TraderVault`, `PoolState`, `PositionRecord`, `LPToken`)
- Collateral settlement calls `test_usdcx_stablecoin.aleo` public transfer rails

### Settlement Mode

`autoperp_core_v5.aleo` is privacy-first but not fully private:

- Private position records are used
- Public settlement rails and public mappings still exist for token/accounting compatibility

## System Architecture

```mermaid
flowchart TB
    subgraph UserLayer[User Layer]
        U1[Trader]
        U2[Liquidity Provider]
        U3[Operator]
    end

    subgraph Frontend[Web Frontend - React TypeScript Vite]
        F1[Trade UI]
        F2[Pool UI]
        F3[Portfolio UI]
        F4[Agent UI]
        F5[Wallet Provider]
        F6[Transaction Hook]
        F7[Private Record Parsers]
    end

    subgraph Wallet[Wallet Layer]
        W1[Shield Wallet Adapter]
    end

    subgraph Chain[Aleo Programs]
        C1[autoperp_core_private_v2.aleo]
        C2[autoperp_core_v5.aleo]
        C3[autoperp_agent_v2.aleo]
        C4[autoperp_oracle.aleo]
        C5[test_usdcx_stablecoin.aleo]
    end

    subgraph DataServices[Off-chain Services]
        S1[Supabase Function - market-prices]
        S2[Supabase Function - agent-chat]
        S3[Gemini API]
        S4[Explorer API]
    end

    U1 --> F1
    U1 --> F3
    U2 --> F2
    U3 --> F4

    F1 --> F5
    F2 --> F5
    F3 --> F5
    F4 --> F5

    F5 --> W1
    F6 --> W1
    F7 --> F1
    F7 --> F2
    F7 --> F3
    F7 --> F4

    W1 --> C1
    W1 --> C2
    W1 --> C3
    W1 --> C4

    C2 --> C5

    F4 --> S2
    S2 --> S3

    F1 --> S1
    F3 --> S1

    F1 --> S4
    F2 --> S4
    F3 --> S4

    classDef private fill:#0f172a,stroke:#22c55e,stroke-width:1px,color:#e2e8f0
    classDef hybrid fill:#111827,stroke:#3b82f6,stroke-width:1px,color:#e2e8f0
    class C1 private
    class C2 hybrid
```

## Contract Roles

### `autoperp_core_private_v2.aleo`

Private record-based perpetual core:

- Private vault state (`TraderVault`)
- Private pool state (`PoolState`)
- Private position lifecycle (`PositionRecord`)
- Private LP accounting (`LPToken`, `FeeReceipt`, `ClaimableFeeEstimate`)

### `autoperp_core_v5.aleo`

Settlement-capable core with USDCx integration:

- Collateral deposit/withdraw
- Position open/close
- LP deposit/withdraw
- Fee accrual and claim

### `autoperp_agent_v2.aleo`

Delegated agent authorization model:

- AgentAuth grant/revoke
- Scoped permissions and expiry
- Execution receipts

### `autoperp_oracle.aleo`

Oracle references:

- Price updates
- Mark price updates
- Funding rate updates

## Frontend Contract Wiring

Program IDs are hardcoded in code (no runtime env switching for core/agent/oracle/pool):

- `PROGRAMS.CORE`: `autoperp_core_private_v2.aleo`
- `PRIVATE_CORE_PROGRAM`: `autoperp_core_private_v2.aleo`
- `PUBLIC_CORE_PROGRAM`: `autoperp_core_v5.aleo`
- `PROGRAMS.AGENT`: `autoperp_agent_v2.aleo`
- `PROGRAMS.ORACLE`: `autoperp_oracle.aleo`
- `PROGRAMS.POOL`: `autoperp_pool_v2.aleo`

Trading mode is selected in-app (Public/Private switch), and resolves to the corresponding hardcoded core program.

## Build and Deploy

### Contract Build Order

```bash
cd programs/autoperp_oracle && leo build
cd ../autoperp_agent && leo build
cd ../autoperp_core && leo build
cd ../autoperp_core_private && leo build
```

### Frontend

```bash
npm install
npm run dev
npm run build
```

## Environment Variables

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (for Supabase `agent-chat` function)

## Operational Notes

- Strict private mode prioritizes private state transitions and privacy scoring.
- Settlement mode prioritizes token settlement compatibility with USDCx rails.
- Ensure frontend program IDs match the deployed contract IDs before running user flows.
