// AutoPerp Core V9 — Leo 4.0
// Public settlement mode with cross-program oracle integration.
// Prices are read from autoperp_oracle_v2.aleo via external storage access.
// Funding rates are applied to trader payouts during close_position settlement.
// Position IDs are client-supplied and verified against on-chain sequence.
// LP shares use NAV-based pricing for fair value distribution.
// USDCx settlement via test_usdcx_stablecoin.aleo

import autoperp_oracle_v2.aleo;
import test_usdcx_stablecoin.aleo;

program autoperp_core_v9.aleo {

    @noupgrade
    constructor() {}

    // ==================== Records ====================

    record PositionRecord {
        owner: address,
        position_id: u64,
        market_id: u8,
        direction: u8,        // 0 = long, 1 = short
        collateral: u64,      // 6-decimal USDCx
        leverage: u64,
        entry_price: u64,     // 8-decimal
        size: u64,            // 6-decimal notional
        stop_loss: u64,
        take_profit: u64,
    }

    record LiquidationAuth {
        owner: address,
        position_id: u64,
        market_id: u8,
        direction: u8,
        size: u64,
        entry_price: u64,
        liquidation_price: u64,
    }

    record LPToken {
        owner: address,
        pool_id: u8,
        shares: u64,
        deposit_amount: u64,
    }

    record FeeReceipt {
        owner: address,
        pool_id: u8,
        claimed_amount: u64,
    }

    record ClaimableFeeEstimate {
        owner: address,
        pool_id: u8,
        estimated_fees: u64,
    }

    // ==================== Structs ====================

    struct PositionParams {
        market_id: u8,
        direction: u8,
        collateral: u64,
        leverage: u64,
        entry_price: u64,
        stop_loss: u64,
        take_profit: u64,
    }

    // ==================== Mappings (public accounting) ====================

    mapping vault: address => u64;
    mapping pool_balance: u8 => u64;
    mapping pool_deposits: u8 => u64;
    mapping pool_shares: u8 => u64;
    mapping pool_fees: u8 => u64;
    mapping open_interest: u8 => u64;
    mapping position_count: u8 => u64;
    mapping next_position_id: u8 => u64;

    // ==================== Constants ====================

    // Fee: 0.06% = 6 / 10000
    // Precision: USDCx = 6 decimals, Price = 8 decimals

    // ==================== Collateral Management ====================

    // Deposit USDCx into public vault (cross-program token transfer)
    fn deposit_collateral(
        public amount: u64,
    ) -> Final {
        assert(amount > 0u64);

        let signer: address = self.signer;

        // Transfer USDCx from signer to this program via token program
        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(
            self.address,
            amount as u128,
        );

        return final {
            transfer.run();
            let current: u64 = Mapping::get_or_use(vault, signer, 0u64);
            Mapping::set(vault, signer, current + amount);
        };
    }

    // Withdraw USDCx from public vault back to wallet
    fn withdraw_collateral(
        public amount: u64,
    ) -> Final {
        assert(amount > 0u64);

        let signer: address = self.signer;

        // Transfer USDCx from this program to signer
        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public(
            signer,
            amount as u128,
        );

        return final {
            transfer.run();
            let current: u64 = Mapping::get_or_use(vault, signer, 0u64);
            assert(current >= amount);
            Mapping::set(vault, signer, current - amount);
        };
    }

    // ==================== Position Management ====================

    // Open a new position — reads oracle price via cross-program storage access
    fn open_position(
        public params: PositionParams,
        public trader: address,
        public position_id: u64,
    ) -> (PositionRecord, LiquidationAuth, Final) {
        assert(params.market_id <= 2u8);
        assert(params.direction <= 1u8);
        assert(params.collateral > 0u64);
        assert(params.leverage >= 1u64);
        assert(params.leverage <= 50u64);

        // Calculate position math
        let notional: u64 = params.collateral * params.leverage;
        let fee: u64 = (notional * 6u64) / 10000u64;
        let collateral_after_fee: u64 = params.collateral - fee;
        assert(collateral_after_fee > 0u64);

        let size: u64 = collateral_after_fee * params.leverage;

        // SL/TP validation
        if (params.direction == 0u8) {
            // Long
            if (params.stop_loss > 0u64) {
                assert(params.stop_loss < params.entry_price);
            }
            if (params.take_profit > 0u64) {
                assert(params.take_profit > params.entry_price);
            }
        } else {
            // Short
            if (params.stop_loss > 0u64) {
                assert(params.stop_loss > params.entry_price);
            }
            if (params.take_profit > 0u64) {
                assert(params.take_profit < params.entry_price);
            }
        }

        // Liquidation price calculation
        let liq_margin: u64 = (params.entry_price * 9u64) / (params.leverage * 10u64);
        let liquidation_price: u64 = params.direction == 0u8 ?
            params.entry_price - liq_margin :
            params.entry_price + liq_margin;

        let position_record: PositionRecord = PositionRecord {
            owner: trader,
            position_id: position_id,
            market_id: params.market_id,
            direction: params.direction,
            collateral: collateral_after_fee,
            leverage: params.leverage,
            entry_price: params.entry_price,
            size: size,
            stop_loss: params.stop_loss,
            take_profit: params.take_profit,
        };

        let liq_auth: LiquidationAuth = LiquidationAuth {
            owner: trader,
            position_id: position_id,
            market_id: params.market_id,
            direction: params.direction,
            size: size,
            entry_price: params.entry_price,
            liquidation_price: liquidation_price,
        };

        return (position_record, liq_auth, final {
            // Read oracle price — fallback to 0 so we can assert oracle is initialized
            let oracle_price: u64 = Mapping::get_or_use(autoperp_oracle_v2.aleo::prices, params.market_id, 0u64);
            assert(oracle_price > 0u64); // Oracle must be initialized for this market

            // Validate user-supplied entry_price is within 1% of oracle price
            let price_diff: u64 = params.entry_price > oracle_price ?
                params.entry_price - oracle_price :
                oracle_price - params.entry_price;
            let max_divergence: u64 = oracle_price / 100u64; // 1%
            assert(price_diff <= max_divergence);

            // Deduct fee + collateral from trader vault
            let vault_balance: u64 = Mapping::get_or_use(vault, trader, 0u64);
            assert(vault_balance >= params.collateral);
            Mapping::set(vault, trader, vault_balance - params.collateral);

            // Add fee to pool
            let current_fees: u64 = Mapping::get_or_use(pool_fees, params.market_id, 0u64);
            Mapping::set(pool_fees, params.market_id, current_fees + fee);

            // Update pool state
            let current_oi: u64 = Mapping::get_or_use(open_interest, params.market_id, 0u64);
            Mapping::set(open_interest, params.market_id, current_oi + size);

            let current_count: u64 = Mapping::get_or_use(position_count, params.market_id, 0u64);
            Mapping::set(position_count, params.market_id, current_count + 1u64);

            // Verify client-supplied position_id matches on-chain sequence
            let current_id: u64 = Mapping::get_or_use(next_position_id, params.market_id, 1u64);
            assert_eq(position_id, current_id);
            Mapping::set(next_position_id, params.market_id, current_id + 1u64);
        });
    }

    // Close position with PnL settlement + funding rate applied to trader payout
    // Funding rate and direction are client-supplied, verified against oracle in finalize
    fn close_position(
        position: PositionRecord,
        public current_price: u64,
        public funding_rate: u64,
        public fund_direction: u8,
    ) -> Final {
        assert_eq(position.owner, self.signer);
        assert(current_price > 0u64);

        // PnL calculation
        let pnl_positive: bool = position.direction == 0u8 ?
            current_price > position.entry_price :
            position.entry_price > current_price;

        let price_diff: u64 = current_price > position.entry_price ?
            current_price - position.entry_price :
            position.entry_price - current_price;

        let abs_pnl: u64 = (position.size * price_diff) / position.entry_price;

        // Calculate base payout from PnL
        let base_payout: u64 = pnl_positive ?
            position.collateral + abs_pnl :
            (position.collateral > abs_pnl ? position.collateral - abs_pnl : 0u64);

        // Apply funding rate to trader payout
        // If direction matches fund_direction → position PAYS funding (payout reduced)
        // If direction differs → position RECEIVES funding (payout increased)
        let funding_amount: u64 = (position.size * funding_rate) / 1000000u64;
        let position_pays_funding: bool = position.direction == fund_direction;

        let payout: u64 = position_pays_funding ?
            (base_payout > funding_amount ? base_payout - funding_amount : 0u64) :
            base_payout + funding_amount;

        // Transfer funding-adjusted USDCx payout from pool to trader
        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public(
            position.owner,
            payout as u128,
        );

        let market_id: u8 = position.market_id;
        let direction: u8 = position.direction;
        let p_size: u64 = position.size;
        let collateral: u64 = position.collateral;

        return final {
            transfer.run();

            // Validate against oracle price (cross-program read)
            let oracle_price: u64 = Mapping::get(autoperp_oracle_v2.aleo::prices, market_id);
            let price_diff_check: u64 = current_price > oracle_price ?
                current_price - oracle_price :
                oracle_price - current_price;
            let max_divergence: u64 = oracle_price / 100u64; // 1%
            assert(price_diff_check <= max_divergence);

            // Verify client-supplied funding params match oracle (cross-program read)
            let oracle_funding_rate: u64 = Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_rates, market_id, 0u64);
            let oracle_fund_direction: u8 = Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_direction, market_id, 0u8);
            assert_eq(funding_rate, oracle_funding_rate);
            assert_eq(fund_direction, oracle_fund_direction);

            // Adjust pool balance with PnL settlement + funding
            let pool_bal: u64 = Mapping::get_or_use(pool_balance, market_id, 0u64);
            if (pnl_positive) {
                let deduction: u64 = payout > collateral ? payout - collateral : 0u64;
                let pool_after_pnl: u64 = pool_bal > deduction ? pool_bal - deduction : 0u64;
                // Pool receives funding from position or pays funding to position
                let final_pool: u64 = position_pays_funding ?
                    pool_after_pnl + funding_amount :
                    (pool_after_pnl > funding_amount ? pool_after_pnl - funding_amount : 0u64);
                Mapping::set(pool_balance, market_id, final_pool);
            } else {
                let pool_gain: u64 = collateral > payout ? collateral - payout : 0u64;
                let pool_after_pnl: u64 = pool_bal + pool_gain;
                let final_pool: u64 = position_pays_funding ?
                    pool_after_pnl + funding_amount :
                    (pool_after_pnl > funding_amount ? pool_after_pnl - funding_amount : 0u64);
                Mapping::set(pool_balance, market_id, final_pool);
            }

            // Update open interest
            let current_oi: u64 = Mapping::get_or_use(open_interest, market_id, 0u64);
            let new_oi: u64 = current_oi > p_size ? current_oi - p_size : 0u64;
            Mapping::set(open_interest, market_id, new_oi);

            // Update position count
            let current_count: u64 = Mapping::get_or_use(position_count, market_id, 0u64);
            let new_count: u64 = current_count > 0u64 ? current_count - 1u64 : 0u64;
            Mapping::set(position_count, market_id, new_count);
        };
    }

    // ==================== Liquidity Pool ====================

    // Deposit liquidity and receive LP token
    // Deposit liquidity with NAV-based LP share pricing
    // computed_shares is calculated client-side: if pool empty → amount, else → (amount * total_shares) / pool_balance
    // Verified against on-chain state in finalize
    fn deposit_liquidity(
        public pool_id: u8,
        public amount: u64,
        public computed_shares: u64,
    ) -> (LPToken, Final) {
        assert(pool_id <= 2u8);
        assert(amount > 0u64);
        assert(computed_shares > 0u64);

        let lp_token: LPToken = LPToken {
            owner: self.signer,
            pool_id: pool_id,
            shares: computed_shares,
            deposit_amount: amount,
        };

        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(
            self.address,
            amount as u128,
        );

        return (lp_token, final {
            transfer.run();

            let current_balance: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
            let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);

            // Verify NAV-based share calculation: if pool is empty → shares == amount
            // Otherwise → shares == (amount * current_shares) / current_balance
            if (current_balance > 0u64 && current_shares > 0u64) {
                let expected_shares: u64 = (amount * current_shares) / current_balance;
                assert_eq(computed_shares, expected_shares);
            } else {
                assert_eq(computed_shares, amount);
            }

            Mapping::set(pool_balance, pool_id, current_balance + amount);

            let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
            Mapping::set(pool_deposits, pool_id, current_deposits + amount);

            Mapping::set(pool_shares, pool_id, current_shares + computed_shares);
        });
    }

    // Withdraw liquidity (burn LP token)
    fn withdraw_liquidity(
        lp_token: LPToken,
    ) -> Final {
        assert_eq(lp_token.owner, self.signer);

        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public(
            lp_token.owner,
            lp_token.deposit_amount as u128,
        );

        let pool_id: u8 = lp_token.pool_id;
        let deposit_amount: u64 = lp_token.deposit_amount;
        let shares: u64 = lp_token.shares;

        return final {
            transfer.run();

            let current_balance: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
            let new_balance: u64 = current_balance > deposit_amount ?
                current_balance - deposit_amount : 0u64;
            Mapping::set(pool_balance, pool_id, new_balance);

            let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
            let new_deposits: u64 = current_deposits > deposit_amount ?
                current_deposits - deposit_amount : 0u64;
            Mapping::set(pool_deposits, pool_id, new_deposits);

            let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
            let new_shares: u64 = current_shares > shares ?
                current_shares - shares : 0u64;
            Mapping::set(pool_shares, pool_id, new_shares);
        };
    }

    // Claim fees pro-rata (public mode — USDCx to wallet)
    fn claim_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> (LPToken, FeeReceipt, Final) {
        assert_eq(lp_token.owner, self.signer);
        assert(total_pool_shares > 0u64);

        let claimable: u64 = (lp_token.shares * total_pool_fees) / total_pool_shares;

        let updated_lp: LPToken = LPToken {
            owner: lp_token.owner,
            pool_id: lp_token.pool_id,
            shares: lp_token.shares,
            deposit_amount: lp_token.deposit_amount,
        };

        let receipt: FeeReceipt = FeeReceipt {
            owner: lp_token.owner,
            pool_id: lp_token.pool_id,
            claimed_amount: claimable,
        };

        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public(
            lp_token.owner,
            claimable as u128,
        );

        let pool_id: u8 = lp_token.pool_id;

        return (updated_lp, receipt, final {
            transfer.run();

            // Verify on-chain values match provided parameters
            let actual_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
            assert_eq(actual_shares, total_pool_shares);

            let actual_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
            assert_eq(actual_fees, total_pool_fees);

            // Deduct claimed fees
            let new_fees: u64 = actual_fees > claimable ? actual_fees - claimable : 0u64;
            Mapping::set(pool_fees, pool_id, new_fees);
        });
    }

    // Read-only estimation of claimable fees
    fn estimate_claimable_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> ClaimableFeeEstimate {
        assert_eq(lp_token.owner, self.signer);

        let estimated: u64 = total_pool_shares > 0u64 ?
            (lp_token.shares * total_pool_fees) / total_pool_shares : 0u64;

        return ClaimableFeeEstimate {
            owner: lp_token.owner,
            pool_id: lp_token.pool_id,
            estimated_fees: estimated,
        };
    }
}
