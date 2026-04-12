# AutoPerp Programs

## Primary deployment set (Leo 4.0)

Deploy these programs for the working settlement-enabled stack:

1. `autoperp_oracle_v2.aleo` — Oracle prices, TWAP mark pricing, funding rates
2. `autoperp_agent_v3.aleo` — Agent delegation with oracle-validated slippage (depends on oracle)
3. `autoperp_core_v9.aleo` — Public settlement with cross-program oracle validation, funding-adjusted payouts, NAV-based LP shares, verified position IDs (depends on oracle + USDCx)

For private record-based trading:

4. `autoperp_core_private_v9.aleo` — Privacy-preserving settlement with oracle validation, funding-adjusted payouts, shielded token transfers, NAV-based LP shares (depends on oracle + USDCx)

## V9 Critical Fixes

V9 introduces five economic security improvements over V8:

| Fix | Description |
|---|---|
| **Oracle fallback security** | `get_or_use` fallback changed to `0u64` + `assert(oracle_price > 0u64)` — oracle must be initialized |
| **Funding-adjusted payouts** | `funding_rate` and `fund_direction` are public inputs to `close_position`, verified via `assert_eq` against oracle, applied to trader payout before transfer |
| **Position ID verification** | `position_id` is a public input to `open_position`, verified via `assert_eq` against `next_position_id` mapping |
| **NAV-based LP shares** | `computed_shares` input to `deposit_liquidity`, verified: `shares = (amount × total_shares) / pool_balance` |
| **Divergence consistency** | Private mode open divergence tightened from 20% to 5% |

## Architecture: Connected Programs

```
autoperp_oracle_v2.aleo
   ├── prices (mapping: u8 => u64)
   ├── mark_prices (mapping: u8 => u64)
   ├── funding_rates (mapping: u8 => u64)
   └── funding_direction (mapping: u8 => u8)
         │
         ├── READ BY autoperp_core_v9.aleo (open_position, close_position)
         ├── READ BY autoperp_core_private_v9.aleo (open_position, close_position)
         └── READ BY autoperp_agent_v3.aleo (execute_agent_action, liquidate_position)
```

Cross-program integration addresses the Wave 4 feedback that "neither core program reads from it (prices are user-supplied inputs)." Both core programs validate user-supplied entry prices against oracle prices via external storage access, funding rates are verified via `assert_eq` and applied to trader payouts during position close.

## Deployed on Aleo Testnet

| Program | Deploy TX ID |
|---|---|
| `autoperp_core_v9.aleo` | `at1nn5nwva0qfzdx7xtxj5s00k33kfhwm3e2vun3cg5ktyv5ec3scgs8mfafh` |
| `autoperp_core_private_v9.aleo` | `at1dffv2t9lg3xltk5rrdz5rt6qr3p2f0ujw0ue47zeyw7g2smqtu8q9drg8t` |
| `autoperp_oracle_v2.aleo` | Previously deployed |
| `autoperp_agent_v3.aleo` | Previously deployed |

## Leo 4.0 Syntax

All programs use Leo 4.0 syntax:
- `fn` replaces `transition`, `function`, and `inline`
- `Final` replaces `Future`
- `final { ... }` blocks replace `async function finalize_xxx()`
- `f.run()` replaces `f.await()`
- `program.aleo::function()` replaces `program.aleo/function()`

## Privacy: Private Token Transfers

`autoperp_core_private_v9.aleo` closes the privacy gap identified in Wave 4:
- **Withdrawals**: Use `transfer_public_to_private` to create private USDCx records (not visible on explorer)
- **Position close payouts**: Use `transfer_public_to_private` for shielded payouts
- **LP fee claims**: Use `transfer_public_to_private` for private fee distribution
- **Deposits**: Use `transfer_public_as_signer` (amount is visible for protocol accounting)

## Pool Scalability

Pool state uses **shared public mappings** (`pool_balance`, `pool_shares`, `pool_fees`, etc.) instead of single-owner `PoolState` records. LP shares use **NAV-based pricing** to prevent dilution.

## Deprecated Programs

| Program | Note |
|---|---|
| `autoperp_core_v8.aleo` | Superseded by V9 |
| `autoperp_core_private_v8.aleo` | Superseded by V9 |
| `autoperp_core_v7.aleo` | Superseded by V8 |
| `autoperp_core_private_v7.aleo` | Superseded by V8 |
| `autoperp_pool_v2.aleo` | Legacy pool helper |

## Program IDs

| Program | Purpose |
|---|---|
| `autoperp_oracle_v2.aleo` | Oracle prices, mark/TWAP, funding data |
| `autoperp_agent_v3.aleo` | Agent delegation with oracle-validated slippage |
| `autoperp_core_v9.aleo` | Public settlement with oracle validation, funding payouts, NAV shares |
| `autoperp_core_private_v9.aleo` | Private settlement with oracle validation, funding payouts, shielded transfers |

## Precision

- USDCx amounts: `1_000_000u64` per token
- Prices: `100_000_000u64` per USD
- Funding rates: `1_000_000u64` = 100% (parts per million)
- Markets: `0u8 = BTC-USD`, `1u8 = ETH-USD`, `2u8 = ALEO-USD`

## Build

```bash
cd programs/autoperp_oracle && leo build
cd ../autoperp_agent && leo build
cd ../autoperp_core && leo build
cd ../autoperp_core_private && leo build
```

## Deploy

Requires Leo 4.0.0+ and WSL/Linux:

```bash
wsl -d Ubuntu -- bash -c "cd /mnt/g/AutoPerp/AutoPerp/programs/autoperp_core && \
  source ~/.cargo/env && \
  leo deploy --network testnet \
  --endpoint https://api.explorer.provable.com/v1 \
  --broadcast --yes \
  --private-key <YOUR_PRIVATE_KEY>"
```

## AgentAuth Frontend Wiring

The frontend calls the agent program directly:
1. `grant_auth()` — Called when user executes a trade via the Agent UI
2. `execute_agent_action()` — Called when SL/TP conditions are met
3. `revoke_auth()` — Available in the Agent Permissions panel
4. `liquidate_position()` — Called when liquidation price is breached

This addresses the Wave 4 feedback that "the agent auth program is deployed but never called by the frontend."
