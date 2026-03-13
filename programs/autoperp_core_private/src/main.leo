import test_usdcx_stablecoin.aleo;

program autoperp_core_private_v2.aleo {
    @noupgrade
    async constructor() {}

    record TraderVault {
        owner: address,
        balance: u64,
    }

    record PoolState {
        owner: address,
        pool_id: u8,
        balance: u64,
        deposits: u64,
        shares: u64,
        fees: u64,
        open_interest: u64,
        position_count: u64,
    }

    record PositionRecord {
        owner: address,
        position_id: field,
        market_id: u8,
        direction: u8,
        collateral: u64,
        leverage: u64,
        entry_price: u64,
        size: u64,
        stop_loss: u64,
        take_profit: u64,
    }

    record LiquidationAuth {
        owner: address,
        position_id: field,
        trader: address,
        liquidation_price: u64,
        market_id: u8,
        direction: u8,
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
        amount: u64,
    }

    record ClaimableFeeEstimate {
        owner: address,
        pool_id: u8,
        user_shares: u64,
        total_pool_shares: u64,
        total_pool_fees: u64,
        estimated_amount: u64,
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

    transition create_vault(
        initial_balance: u64,
    ) -> TraderVault {
        return TraderVault {
            owner: self.signer,
            balance: initial_balance,
        };
    }

    transition bootstrap_pool(
        pool_id: u8,
        initial_liquidity: u64,
    ) -> PoolState {
        assert(pool_id <= 2u8);

        return PoolState {
            owner: self.signer,
            pool_id,
            balance: initial_liquidity,
            deposits: initial_liquidity,
            shares: initial_liquidity,
            fees: 0u64,
            open_interest: 0u64,
            position_count: 0u64,
        };
    }

    async transition deposit_collateral(
        vault: TraderVault,
        amount: u64,
    ) -> (TraderVault, Future) {
        assert_eq(vault.owner, self.signer);
        assert(amount > 0u64);

        let next_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance + amount,
        };

        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(self.address, amount as u128);
        return (next_vault, finalize_deposit_collateral(transfer));
    }

    async function finalize_deposit_collateral(
        transfer: Future,
    ) {
        transfer.await();
    }

    async transition withdraw_collateral(
        vault: TraderVault,
        amount: u64,
    ) -> (TraderVault, Future) {
        assert_eq(vault.owner, self.signer);
        assert(amount > 0u64);
        assert(vault.balance >= amount);

        let next_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance - amount,
        };

        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public(self.signer, amount as u128);
        return (next_vault, finalize_withdraw_collateral(transfer));
    }

    async function finalize_withdraw_collateral(
        transfer: Future,
    ) {
        transfer.await();
    }

    transition open_position(
        vault: TraderVault,
        pool: PoolState,
        params: PositionParams,
        agent_address: address,
    ) -> (TraderVault, PoolState, PositionRecord, LiquidationAuth) {
        assert_eq(vault.owner, self.signer);
        assert_eq(pool.owner, self.signer);
        assert(params.market_id <= 2u8);
        assert(params.direction <= 1u8);
        assert(params.collateral > 0u64);
        assert(params.leverage >= 1u64);
        assert(params.leverage <= 50u64);
        assert(params.entry_price > 0u64);
        assert(vault.balance >= params.collateral);

        let size: u64 = params.collateral * params.leverage;
        let fee: u64 = (size * 6u64) / 10000u64;
        assert(params.collateral > fee);
        let collateral_after_fee: u64 = params.collateral - fee;

        let price_delta: u64 = (params.entry_price * 90u64) / (params.leverage * 100u64);
        let liquidation_price: u64 = params.direction == 0u8
            ? params.entry_price - price_delta
            : params.entry_price + price_delta;

        let position_id: field = BHP256::hash_to_field(params);

        let next_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance - params.collateral,
        };

        let next_pool: PoolState = PoolState {
            owner: pool.owner,
            pool_id: pool.pool_id,
            balance: pool.balance + params.collateral,
            deposits: pool.deposits,
            shares: pool.shares,
            fees: pool.fees + fee,
            open_interest: pool.open_interest + size,
            position_count: pool.position_count + 1u64,
        };

        let position: PositionRecord = PositionRecord {
            owner: self.signer,
            position_id,
            market_id: params.market_id,
            direction: params.direction,
            collateral: collateral_after_fee,
            leverage: params.leverage,
            entry_price: params.entry_price,
            size,
            stop_loss: params.stop_loss,
            take_profit: params.take_profit,
        };

        let liq_auth: LiquidationAuth = LiquidationAuth {
            owner: agent_address,
            position_id,
            trader: self.signer,
            liquidation_price,
            market_id: params.market_id,
            direction: params.direction,
        };

        return (next_vault, next_pool, position, liq_auth);
    }

    transition close_position(
        position: PositionRecord,
        vault: TraderVault,
        pool: PoolState,
        current_price: u64,
    ) -> (TraderVault, PoolState) {
        assert_eq(position.owner, self.signer);
        assert_eq(vault.owner, self.signer);
        assert_eq(pool.owner, self.signer);
        assert(current_price > 0u64);

        let long_profit: bool = position.direction == 0u8 && current_price >= position.entry_price;
        let short_profit: bool = position.direction == 1u8 && current_price <= position.entry_price;
        let is_profit: bool = long_profit || short_profit;

        let long_gain: u64 = (position.direction == 0u8 && current_price >= position.entry_price)
            ? current_price - position.entry_price
            : 0u64;
        let long_loss: u64 = (position.direction == 0u8 && current_price < position.entry_price)
            ? position.entry_price - current_price
            : 0u64;
        let short_gain: u64 = (position.direction == 1u8 && current_price <= position.entry_price)
            ? position.entry_price - current_price
            : 0u64;
        let short_loss: u64 = (position.direction == 1u8 && current_price > position.entry_price)
            ? current_price - position.entry_price
            : 0u64;

        let price_delta: u64 = long_gain + long_loss + short_gain + short_loss;
        let raw_pnl: u64 = (position.size * price_delta) / position.entry_price;
        let max_profit: u64 = pool.balance > position.collateral ? pool.balance - position.collateral : 0u64;
        let pnl: u64 = raw_pnl > max_profit ? max_profit : raw_pnl;
        let gross_loss: u64 = raw_pnl > position.collateral ? position.collateral : raw_pnl;
        let payout: u64 = is_profit
            ? position.collateral + pnl
            : (position.collateral > gross_loss ? position.collateral - gross_loss : 0u64);

        let next_pool_balance: u64 = pool.balance > payout ? pool.balance - payout : 0u64;
        let next_open_interest: u64 = pool.open_interest > position.size ? pool.open_interest - position.size : 0u64;
        let next_position_count: u64 = pool.position_count > 0u64 ? pool.position_count - 1u64 : 0u64;

        let next_vault: TraderVault = TraderVault {
            owner: vault.owner,
            balance: vault.balance + payout,
        };

        let next_pool: PoolState = PoolState {
            owner: pool.owner,
            pool_id: pool.pool_id,
            balance: next_pool_balance,
            deposits: pool.deposits,
            shares: pool.shares,
            fees: pool.fees,
            open_interest: next_open_interest,
            position_count: next_position_count,
        };

        return (next_vault, next_pool);
    }

    transition deposit_liquidity(
        pool: PoolState,
        amount: u64,
    ) -> (PoolState, LPToken) {
        assert_eq(pool.owner, self.signer);
        assert(amount > 0u64);

        let lp_token: LPToken = LPToken {
            owner: self.signer,
            pool_id: pool.pool_id,
            shares: amount,
            deposit_amount: amount,
        };

        let next_pool: PoolState = PoolState {
            owner: pool.owner,
            pool_id: pool.pool_id,
            balance: pool.balance + amount,
            deposits: pool.deposits + amount,
            shares: pool.shares + amount,
            fees: pool.fees,
            open_interest: pool.open_interest,
            position_count: pool.position_count,
        };

        return (next_pool, lp_token);
    }

    transition withdraw_liquidity(
        lp_token: LPToken,
        pool: PoolState,
    ) -> (PoolState, TraderVault) {
        assert_eq(lp_token.owner, self.signer);
        assert_eq(pool.owner, self.signer);
        assert(pool.balance >= lp_token.deposit_amount);
        assert(pool.deposits >= lp_token.deposit_amount);
        assert(pool.shares >= lp_token.shares);

        let next_pool: PoolState = PoolState {
            owner: pool.owner,
            pool_id: pool.pool_id,
            balance: pool.balance - lp_token.deposit_amount,
            deposits: pool.deposits - lp_token.deposit_amount,
            shares: pool.shares - lp_token.shares,
            fees: pool.fees,
            open_interest: pool.open_interest,
            position_count: pool.position_count,
        };

        let payout_vault: TraderVault = TraderVault {
            owner: self.signer,
            balance: lp_token.deposit_amount,
        };

        return (next_pool, payout_vault);
    }

    transition claim_fees(
        lp_token: LPToken,
        pool: PoolState,
    ) -> (PoolState, LPToken, FeeReceipt) {
        assert_eq(lp_token.owner, self.signer);
        assert_eq(pool.owner, self.signer);
        assert(pool.shares > 0u64);

        let fee_amount: u64 = (lp_token.shares * pool.fees) / pool.shares;
        assert(pool.fees >= fee_amount);
        assert(pool.balance >= fee_amount);

        let next_pool: PoolState = PoolState {
            owner: pool.owner,
            pool_id: pool.pool_id,
            balance: pool.balance - fee_amount,
            deposits: pool.deposits,
            shares: pool.shares,
            fees: pool.fees - fee_amount,
            open_interest: pool.open_interest,
            position_count: pool.position_count,
        };

        let returned_lp: LPToken = LPToken {
            owner: lp_token.owner,
            pool_id: lp_token.pool_id,
            shares: lp_token.shares,
            deposit_amount: lp_token.deposit_amount,
        };

        let receipt: FeeReceipt = FeeReceipt {
            owner: self.signer,
            pool_id: lp_token.pool_id,
            amount: fee_amount,
        };

        return (next_pool, returned_lp, receipt);
    }

    transition estimate_claimable_fees(
        lp_token: LPToken,
        pool: PoolState,
    ) -> ClaimableFeeEstimate {
        assert_eq(lp_token.owner, self.signer);
        assert_eq(pool.owner, self.signer);

        let estimated_amount: u64 = pool.shares > 0u64
            ? (lp_token.shares * pool.fees) / pool.shares
            : 0u64;

        return ClaimableFeeEstimate {
            owner: self.signer,
            pool_id: lp_token.pool_id,
            user_shares: lp_token.shares,
            total_pool_shares: pool.shares,
            total_pool_fees: pool.fees,
            estimated_amount,
        };
    }
}
