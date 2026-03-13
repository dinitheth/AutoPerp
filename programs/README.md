# AutoPerp Programs

## Primary deployment set

Deploy these programs for the working settlement-enabled stack:

1. `autoperp_oracle.aleo`
2. `autoperp_agent_v2.aleo`
3. `autoperp_core_v5.aleo`

For strict privacy demonstrations, an additional record-only core exists:

4. `autoperp_core_private_v1.aleo` (no public mappings, no public transition inputs, no public token transfer calls)

`autoperp_core_v5.aleo` is now the single settlement contract for:

- trader collateral deposits
- LP liquidity deposits
- fee accrual
- trader payouts
- LP withdrawals
- LP fee claims

## Deprecated helper

`autoperp_pool_v2.aleo` is kept in this repo only for compatibility and experimentation. The frontend no longer depends on it for live liquidity deposits.

## Program IDs

| Program | Purpose |
|---|---|
| `autoperp_oracle.aleo` | Oracle prices and mark/funding data |
| `autoperp_agent_v2.aleo` | Agent delegation and execution |
| `autoperp_core_v5.aleo` | Unified settlement, trading, LP accounting |
| `autoperp_core_private_v1.aleo` | Strict-private record-only perpetual core for privacy-first judging tracks |
| `autoperp_pool_v2.aleo` | Deprecated standalone pool helper |

## Precision

- USDCx amounts: `1_000_000u64` per token
- Prices: `100_000_000u64` per USD
- Markets: `0u8 = BTC-USD`, `1u8 = ETH-USD`, `2u8 = ALEO-USD`

## Build

```bash
cd programs/autoperp_oracle && leo build
cd ../autoperp_agent && leo build
cd ../autoperp_core && leo build
cd ../autoperp_core_private && leo build
cd ../autoperp_pool && leo build
```

## Settlement note

The old `autoperp_core_v2.aleo` and `autoperp_pool.aleo` testnet deployments only changed internal mappings and did not move real USDCx. The fixed stack in this repo requires redeploying `autoperp_core_v5.aleo` before enabling live trading or pool deposits in the frontend.

For the latest private-first API and on-chain LP claimable-fee estimation, redeploy `autoperp_core_v5.aleo` and set `VITE_AUTOPERP_CORE_PROGRAM=autoperp_core_v5.aleo` in your frontend environment.

If judging criteria require maximum privacy over real-token settlement parity, deploy `autoperp_core_private_v1.aleo`. That path keeps state and transitions private via records, but requires a private-asset UX/integration flow rather than the current public USDCx settlement rails.
