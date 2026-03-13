import test_usdcx_stablecoin.aleo;

program autoperp_core_v5.aleo {
    @noupgrade
    async constructor() {}

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

    mapping vault: address => u64;
    mapping pool_balance: u8 => u64;
    mapping pool_deposits: u8 => u64;
    mapping pool_shares: u8 => u64;
    mapping pool_fees: u8 => u64;
    mapping position_commitments: field => bool;
    mapping open_interest: u8 => u64;
    mapping position_count: u8 => u64;

    async transition open_position(
        params: PositionParams,
        agent_address: address,
    ) -> (PositionRecord, LiquidationAuth, Future) {
        assert(params.market_id <= 2u8);
        assert(params.direction <= 1u8);
        assert(params.collateral > 0u64);
        assert(params.leverage >= 1u64);
        assert(params.leverage <= 50u64);
        assert(params.entry_price > 0u64);

        let size: u64 = params.collateral * params.leverage;
        let fee: u64 = (size * 6u64) / 10000u64;
        assert(params.collateral > fee);
        let collateral_after_fee: u64 = params.collateral - fee;
        let price_delta: u64 = (params.entry_price * 90u64) / (params.leverage * 100u64);
        let liquidation_price: u64 = params.direction == 0u8 ?
            params.entry_price - price_delta :
            params.entry_price + price_delta;
        let position_id: field = BHP256::hash_to_field(params);
        let commitment: field = BHP256::hash_to_field(position_id);

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

        return (
            position,
            liq_auth,
            finalize_open_position(
                self.signer,
                params.market_id,
                params.collateral,
                fee,
                commitment,
                size,
            )
        );
    }

    async function finalize_open_position(
        trader: address,
        pool_id: u8,
        collateral: u64,
        fee: u64,
        commitment: field,
        size: u64,
    ) {
        let trader_balance: u64 = Mapping::get_or_use(vault, trader, 0u64);
        assert(trader_balance >= collateral);
        Mapping::set(vault, trader, trader_balance - collateral);

        let pool_bal: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
        Mapping::set(pool_balance, pool_id, pool_bal + collateral);

        let current_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
        Mapping::set(pool_fees, pool_id, current_fees + fee);
        Mapping::set(position_commitments, commitment, true);

        let oi: u64 = Mapping::get_or_use(open_interest, pool_id, 0u64);
        Mapping::set(open_interest, pool_id, oi + size);

        let cnt: u64 = Mapping::get_or_use(position_count, pool_id, 0u64);
        Mapping::set(position_count, pool_id, cnt + 1u64);
    }

    async transition deposit_collateral(
        amount: u64,
    ) -> Future {
        assert(amount > 0u64);
        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(self.address, amount as u128);
        return finalize_deposit_collateral(transfer, self.signer, amount);
    }

    async function finalize_deposit_collateral(
        transfer: Future,
        trader: address,
        amount: u64,
    ) {
        transfer.await();
        let current: u64 = Mapping::get_or_use(vault, trader, 0u64);
        Mapping::set(vault, trader, current + amount);
    }

    async transition close_position(
        position: PositionRecord,
        current_price: u64,
    ) -> Future {
        assert_eq(position.owner, self.signer);
        assert(current_price > 0u64);

        let commitment: field = BHP256::hash_to_field(position.position_id);

        return finalize_close_position(
            position.owner,
            position.market_id,
            position.direction,
            position.size,
            position.collateral,
            position.entry_price,
            current_price,
            commitment,
        );
    }

    async function finalize_close_position(
        trader: address,
        pool_id: u8,
        direction: u8,
        size: u64,
        collateral: u64,
        entry_price: u64,
        current_price: u64,
        commitment: field,
    ) {
        let pool_bal: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
        let long_profit: bool = direction == 0u8 && current_price >= entry_price;
        let short_profit: bool = direction == 1u8 && current_price <= entry_price;
        let is_profit: bool = long_profit || short_profit;

        let long_gain: u64 = (direction == 0u8 && current_price >= entry_price) ? current_price - entry_price : 0u64;
        let long_loss: u64 = (direction == 0u8 && current_price < entry_price) ? entry_price - current_price : 0u64;
        let short_gain: u64 = (direction == 1u8 && current_price <= entry_price) ? entry_price - current_price : 0u64;
        let short_loss: u64 = (direction == 1u8 && current_price > entry_price) ? current_price - entry_price : 0u64;
        let price_delta: u64 = long_gain + long_loss + short_gain + short_loss;
        let raw_pnl: u64 = (size * price_delta) / entry_price;
        let max_profit: u64 = pool_bal > collateral ? pool_bal - collateral : 0u64;
        let pnl: u64 = raw_pnl > max_profit ? max_profit : raw_pnl;
        let gross_loss: u64 = raw_pnl > collateral ? collateral : raw_pnl;
        let payout: u64 = is_profit ? collateral + pnl : (collateral > gross_loss ? collateral - gross_loss : 0u64);
        let new_pool: u64 = pool_bal > payout ? pool_bal - payout : 0u64;
        Mapping::set(pool_balance, pool_id, new_pool);

        let trader_vault: u64 = Mapping::get_or_use(vault, trader, 0u64);
        Mapping::set(vault, trader, trader_vault + payout);
        Mapping::set(position_commitments, commitment, false);

        let oi: u64 = Mapping::get_or_use(open_interest, pool_id, 0u64);
        let new_oi: u64 = oi > size ? oi - size : 0u64;
        Mapping::set(open_interest, pool_id, new_oi);

        let cnt: u64 = Mapping::get_or_use(position_count, pool_id, 0u64);
        let new_cnt: u64 = cnt > 0u64 ? cnt - 1u64 : 0u64;
        Mapping::set(position_count, pool_id, new_cnt);
    }

    async transition withdraw_collateral(
        amount: u64,
    ) -> Future {
        assert(amount > 0u64);
        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public(self.signer, amount as u128);
        return finalize_withdraw_collateral(transfer, self.signer, amount);
    }

    async function finalize_withdraw_collateral(
        transfer: Future,
        trader: address,
        amount: u64,
    ) {
        let balance: u64 = Mapping::get_or_use(vault, trader, 0u64);
        assert(balance >= amount);
        Mapping::set(vault, trader, balance - amount);
        transfer.await();
    }

    async transition deposit_liquidity(
        pool_id: u8,
        amount: u64,
    ) -> (LPToken, Future) {
        assert(pool_id <= 2u8);
        assert(amount > 0u64);

        let lp_token: LPToken = LPToken {
            owner: self.signer,
            pool_id,
            shares: amount,
            deposit_amount: amount,
        };

        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(self.address, amount as u128);
        return (lp_token, finalize_deposit_liquidity(transfer, pool_id, amount));
    }

    async function finalize_deposit_liquidity(
        transfer: Future,
        pool_id: u8,
        amount: u64,
    ) {
        transfer.await();
        let current_balance: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
        Mapping::set(pool_balance, pool_id, current_balance + amount);

        let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
        Mapping::set(pool_deposits, pool_id, current_deposits + amount);

        let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
        Mapping::set(pool_shares, pool_id, current_shares + amount);
    }

    async transition withdraw_liquidity(
        lp_token: LPToken,
    ) -> Future {
        assert_eq(lp_token.owner, self.signer);
        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public(self.signer, lp_token.deposit_amount as u128);
        return finalize_withdraw_liquidity(
            transfer,
            lp_token.pool_id,
            lp_token.shares,
            lp_token.deposit_amount,
        );
    }

    async function finalize_withdraw_liquidity(
        transfer: Future,
        pool_id: u8,
        shares: u64,
        deposit_amount: u64,
    ) {
        let pool_bal: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
        assert(pool_bal >= deposit_amount);

        let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
        assert(current_deposits >= deposit_amount);
        Mapping::set(pool_deposits, pool_id, current_deposits - deposit_amount);

        let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
        assert(current_shares >= shares);
        Mapping::set(pool_shares, pool_id, current_shares - shares);
        Mapping::set(pool_balance, pool_id, pool_bal - deposit_amount);
        transfer.await();
    }

    async transition claim_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> (LPToken, FeeReceipt, Future) {
        assert_eq(lp_token.owner, self.signer);
        assert(total_pool_shares > 0u64);
        let fee_amount: u64 = (lp_token.shares * total_pool_fees) / total_pool_shares;

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

        let transfer: Future = test_usdcx_stablecoin.aleo/transfer_public(self.signer, fee_amount as u128);
        return (
            returned_lp,
            receipt,
            finalize_claim_fees(
                transfer,
                lp_token.pool_id,
                fee_amount,
                total_pool_shares,
                total_pool_fees,
            )
        );
    }

    transition estimate_claimable_fees(
        lp_token: LPToken,
        public total_pool_shares: u64,
        public total_pool_fees: u64,
    ) -> ClaimableFeeEstimate {
        assert_eq(lp_token.owner, self.signer);
        let estimated_amount: u64 = total_pool_shares > 0u64
            ? (lp_token.shares * total_pool_fees) / total_pool_shares
            : 0u64;

        return ClaimableFeeEstimate {
            owner: self.signer,
            pool_id: lp_token.pool_id,
            user_shares: lp_token.shares,
            total_pool_shares,
            total_pool_fees,
            estimated_amount,
        };
    }

    async function finalize_claim_fees(
        transfer: Future,
        pool_id: u8,
        fee_amount: u64,
        total_pool_shares: u64,
        total_pool_fees: u64,
    ) {
        let shares_on_chain: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
        assert_eq(shares_on_chain, total_pool_shares);

        let current_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
        assert_eq(current_fees, total_pool_fees);
        assert(current_fees >= fee_amount);
        Mapping::set(pool_fees, pool_id, current_fees - fee_amount);

        let current_balance: u64 = Mapping::get_or_use(pool_balance, pool_id, 0u64);
        assert(current_balance >= fee_amount);
        Mapping::set(pool_balance, pool_id, current_balance - fee_amount);
        transfer.await();
    }

    transition adjust_leverage(
        position: PositionRecord,
        new_leverage: u64,
    ) -> PositionRecord {
        assert_eq(position.owner, self.signer);
        assert(new_leverage >= 1u64);
        assert(new_leverage <= 50u64);

        let new_size: u64 = position.collateral * new_leverage;

        return PositionRecord {
            owner: position.owner,
            position_id: position.position_id,
            market_id: position.market_id,
            direction: position.direction,
            collateral: position.collateral,
            leverage: new_leverage,
            entry_price: position.entry_price,
            size: new_size,
            stop_loss: position.stop_loss,
            take_profit: position.take_profit,
        };
    }

    transition update_risk_params(
        position: PositionRecord,
        new_stop_loss: u64,
        new_take_profit: u64,
    ) -> PositionRecord {
        assert_eq(position.owner, self.signer);

        return PositionRecord {
            owner: position.owner,
            position_id: position.position_id,
            market_id: position.market_id,
            direction: position.direction,
            collateral: position.collateral,
            leverage: position.leverage,
            entry_price: position.entry_price,
            size: position.size,
            stop_loss: new_stop_loss,
            take_profit: new_take_profit,
        };
    }
}


