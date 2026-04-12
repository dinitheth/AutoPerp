import autoperp_oracle_v2.aleo;
import test_usdcx_stablecoin.aleo;

program autoperp_core_private_v9.aleo {

    @noupgrade
    constructor() {}

    record TraderVault {
        owner: address,
        balance: u64,
    }

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

    struct PositionParams {
        market_id: u8,
        direction: u8,
        collateral: u64,
        leverage: u64,
        entry_price: u64,
        stop_loss: u64,
        take_profit: u64,
    }

    mapping pool_balance: u8 => u64;
    mapping pool_deposits: u8 => u64;
    mapping pool_shares: u8 => u64;
    mapping pool_fees: u8 => u64;
    mapping open_interest: u8 => u64;
    mapping position_count: u8 => u64;
    mapping next_position_id: u8 => u64;

    fn create_vault(
        initial_balance: u64,
    ) -> TraderVault {
        return TraderVault {
            owner: self.signer,
            balance: initial_balance,
        };
    }

    fn deposit_collateral(
        vault: TraderVault,
        public amount: u64,
    ) -> (TraderVault, Final) {
        assert_eq(vault.owner, self.signer);
        assert(amount > 0u64);

        let transfer: Final = test_usdcx_stablecoin.aleo::transfer_public_as_signer(
            self.address,
            amount as u128,
        );

        let updated_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance + amount,
        };

        return (updated_vault, final {
            transfer.run();
        });
    }

    fn withdraw_collateral(
        vault: TraderVault,
        public amount: u64,
    ) -> (TraderVault, test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) {
        assert_eq(vault.owner, self.signer);
        assert(amount > 0u64);
        assert(vault.balance >= amount);

        let updated_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance - amount,
        };

        let (cr_record, token_record, transfer): (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(
            vault.owner,
            amount as u128,
        );

        return (updated_vault, cr_record, token_record, final {
            transfer.run();
        });
    }

    fn open_position(
        vault: TraderVault,
        public params: PositionParams,
        public position_id: u64,
    ) -> (TraderVault, PositionRecord, LiquidationAuth, Final) {
        assert_eq(vault.owner, self.signer);
        assert(params.market_id <= 2u8);
        assert(params.direction <= 1u8);
        assert(params.collateral > 0u64);
        assert(params.leverage >= 1u64);
        assert(params.leverage <= 50u64);
        assert(vault.balance >= params.collateral);

        let notional: u64 = params.collateral * params.leverage;
        let fee: u64 = (notional * 6u64) / 10000u64;
        let collateral_after_fee: u64 = params.collateral - fee;
        assert(collateral_after_fee > 0u64);

        let size: u64 = collateral_after_fee * params.leverage;

        if (params.direction == 0u8) {
            if (params.stop_loss > 0u64) {
                assert(params.stop_loss < params.entry_price);
            }
            if (params.take_profit > 0u64) {
                assert(params.take_profit > params.entry_price);
            }
        } else {
            if (params.stop_loss > 0u64) {
                assert(params.stop_loss > params.entry_price);
            }
            if (params.take_profit > 0u64) {
                assert(params.take_profit < params.entry_price);
            }
        }

        let liq_margin: u64 = (params.entry_price * 9u64) / (params.leverage * 10u64);
        let liquidation_price: u64 = params.direction == 0u8 ?
            params.entry_price - liq_margin :
            params.entry_price + liq_margin;

        let updated_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance - params.collateral,
        };

        let position_record: PositionRecord = PositionRecord {
            owner: vault.owner,
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
            owner: vault.owner,
            position_id: position_id,
            market_id: params.market_id,
            direction: params.direction,
            size: size,
            entry_price: params.entry_price,
            liquidation_price: liquidation_price,
        };

        return (updated_vault, position_record, liq_auth, final {
            // Read oracle price — fallback to 0 so we can assert oracle is initialized
            let oracle_price: u64 = Mapping::get_or_use(autoperp_oracle_v2.aleo::prices, params.market_id, 0u64);
            assert(oracle_price > 0u64); // Oracle must be initialized for this market

            // Safe subtraction for divergence check
            let larger_price: u64 = params.entry_price > oracle_price ? params.entry_price : oracle_price;
            let smaller_price: u64 = params.entry_price > oracle_price ? oracle_price : params.entry_price;
            let price_diff: u64 = larger_price - smaller_price;

            let max_divergence: u64 = oracle_price / 20u64; // 5% for private mode
            assert(price_diff <= max_divergence);

            let current_fees: u64 = Mapping::get_or_use(pool_fees, params.market_id, 0u64);
            Mapping::set(pool_fees, params.market_id, current_fees + fee);

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

    // Close position with funding rate applied to trader payout
    // Funding params are client-supplied, verified against oracle in finalize
    fn close_position(
        position: PositionRecord,
        public current_price: u64,
        public funding_rate: u64,
        public fund_direction: u8,
    ) -> (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) {
        assert_eq(position.owner, self.signer);
        assert(current_price > 0u64);

        let pnl_positive: bool = position.direction == 0u8 ?
            current_price > position.entry_price :
            position.entry_price > current_price;

        let larger_pr: u64 = current_price > position.entry_price ? current_price : position.entry_price;
        let smaller_pr: u64 = current_price > position.entry_price ? position.entry_price : current_price;
        let p_diff: u64 = larger_pr - smaller_pr;

        let abs_pnl: u64 = (position.size * p_diff) / position.entry_price;

        // Calculate base payout from PnL
        let base_payout: u64 = pnl_positive ?
            position.collateral + abs_pnl :
            (position.collateral > abs_pnl ? position.collateral - abs_pnl : 0u64);

        // Apply funding rate to trader payout
        let funding_amount: u64 = (position.size * funding_rate) / 1000000u64;
        let position_pays: bool = position.direction == fund_direction;

        let payout: u64 = position_pays ?
            (base_payout > funding_amount ? base_payout - funding_amount : 0u64) :
            base_payout + funding_amount;

        // Transfer funding-adjusted payout as private token (shielded)
        let (cr_record, token_record, transfer): (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(
            position.owner,
            payout as u128,
        );

        let market_id: u8 = position.market_id;
        let direction: u8 = position.direction;
        let p_size: u64 = position.size;
        let collateral: u64 = position.collateral;

        return (cr_record, token_record, final {
            transfer.run();

            let oracle_price: u64 = Mapping::get(autoperp_oracle_v2.aleo::prices, market_id);

            let larger_p: u64 = current_price > oracle_price ? current_price : oracle_price;
            let smaller_p: u64 = current_price > oracle_price ? oracle_price : current_price;
            let check_diff: u64 = larger_p - smaller_p;
            
            let max_div: u64 = oracle_price / 100u64; // 1%
            assert(check_diff <= max_div);

            // Verify client-supplied funding params match oracle
            let oracle_funding_rate: u64 = Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_rates, market_id, 0u64);
            let oracle_fund_direction: u8 = Mapping::get_or_use(autoperp_oracle_v2.aleo::funding_direction, market_id, 0u8);
            assert_eq(funding_rate, oracle_funding_rate);
            assert_eq(fund_direction, oracle_fund_direction);

            let pool_bal: u64 = Mapping::get_or_use(pool_balance, market_id, 0u64);
            if (pnl_positive) {
                let deduction: u64 = payout > collateral ? payout - collateral : 0u64;
                let safe_deduction: u64 = pool_bal > deduction ? deduction : pool_bal;
                let after_pnl: u64 = pool_bal - safe_deduction;
                let safe_funding: u64 = after_pnl > funding_amount ? funding_amount : after_pnl;
                let final_bal: u64 = position_pays ?
                    after_pnl + funding_amount :
                    after_pnl - safe_funding;
                Mapping::set(pool_balance, market_id, final_bal);
            } else {
                let gain: u64 = collateral > payout ? collateral - payout : 0u64;
                let after_pnl: u64 = pool_bal + gain;
                let safe_funding: u64 = after_pnl > funding_amount ? funding_amount : after_pnl;
                let final_bal: u64 = position_pays ?
                    after_pnl + funding_amount :
                    after_pnl - safe_funding;
                Mapping::set(pool_balance, market_id, final_bal);
            }

            let current_oi: u64 = Mapping::get_or_use(open_interest, market_id, 0u64);
            let safe_oi_sub: u64 = current_oi > p_size ? p_size : current_oi;
            Mapping::set(open_interest, market_id, current_oi - safe_oi_sub);

            let current_count: u64 = Mapping::get_or_use(position_count, market_id, 0u64);
            let safe_count_sub: u64 = current_count > 0u64 ? 1u64 : 0u64;
            Mapping::set(position_count, market_id, current_count - safe_count_sub);
        });
    }

    // Deposit liquidity with NAV-based LP share pricing
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

            let cb: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
            let cs: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);

            // Verify NAV-based share calculation
            if (cb > 0u64 && cs > 0u64) {
                let expected_shares: u64 = (amount * cs) / cb;
                assert_eq(computed_shares, expected_shares);
            } else {
                assert_eq(computed_shares, amount);
            }

            Mapping::set(pool_balance, pool_id, cb + amount);

            let cd: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
            Mapping::set(pool_deposits, pool_id, cd + amount);

            Mapping::set(pool_shares, pool_id, cs + computed_shares);
        });
    }

    fn withdraw_liquidity(
        lp_token: LPToken,
    ) -> (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) {
        assert_eq(lp_token.owner, self.signer);

        let (cr_record, token_record, transfer): (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(
            lp_token.owner,
            lp_token.deposit_amount as u128,
        );

        let pool_id: u8 = lp_token.pool_id;
        let deposit_amount: u64 = lp_token.deposit_amount;
        let shares: u64 = lp_token.shares;

        return (cr_record, token_record, final {
            transfer.run();

            let cb: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
            let safe_deposit_cb: u64 = cb > deposit_amount ? deposit_amount : cb;
            Mapping::set(pool_balance, pool_id, cb - safe_deposit_cb);

            let cd: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
            let safe_deposit_cd: u64 = cd > deposit_amount ? deposit_amount : cd;
            Mapping::set(pool_deposits, pool_id, cd - safe_deposit_cd);

            let cs: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
            let safe_shares_cs: u64 = cs > shares ? shares : cs;
            Mapping::set(pool_shares, pool_id, cs - safe_shares_cs);
        });
    }

    fn claim_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> (LPToken, FeeReceipt, test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) {
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

        let (cr_record, token_record, transfer): (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) = test_usdcx_stablecoin.aleo::transfer_public_to_private(
            lp_token.owner,
            claimable as u128,
        );

        let pool_id: u8 = lp_token.pool_id;

        return (updated_lp, receipt, cr_record, token_record, final {
            transfer.run();

            let actual_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
            assert_eq(actual_shares, total_pool_shares);

            let actual_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
            assert_eq(actual_fees, total_pool_fees);

            let safe_claimable: u64 = actual_fees > claimable ? claimable : actual_fees;
            let new_fees: u64 = actual_fees - safe_claimable;
            Mapping::set(pool_fees, pool_id, new_fees);
        });
    }

    fn estimate_claimable_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> ClaimableFeeEstimate {
        assert_eq(lp_token.owner, self.signer);

        let safe_divisor: u64 = total_pool_shares > 0u64 ? total_pool_shares : 1u64;
        let estimated: u64 = total_pool_shares > 0u64 ?
            (lp_token.shares * total_pool_fees) / safe_divisor : 0u64;

        return ClaimableFeeEstimate {
            owner: lp_token.owner,
            pool_id: lp_token.pool_id,
            estimated_fees: estimated,
        };
    }
}
