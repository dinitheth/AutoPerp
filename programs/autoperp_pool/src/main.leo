import token_registry.aleo;

program autoperp_pool_v2.aleo {
    @noupgrade
    async constructor() {}

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

    struct PoolStats {
        total_deposits: u64,
        total_shares: u64,
        accumulated_fees: u64,
        utilization: u64,
    }

    mapping pool_deposits: u8 => u64;
    mapping pool_shares: u8 => u64;
    mapping pool_fees: u8 => u64;
    mapping pool_utilization: u8 => u64;

    async transition deposit(
        public token_id: field,
        public pool_id: u8,
        public amount: u64,
    ) -> (LPToken, Future) {
        assert(pool_id <= 2u8);
        assert(amount > 0u64);

        let lp_token: LPToken = LPToken {
            owner: self.signer,
            pool_id,
            shares: amount,
            deposit_amount: amount,
        };

        let transfer: Future = token_registry.aleo/transfer_public_as_signer(token_id, self.address, amount as u128);
        return (lp_token, finalize_deposit(transfer, pool_id, amount));
    }

    async function finalize_deposit(
        transfer: Future,
        pool_id: u8,
        amount: u64,
    ) {
        transfer.await();
        let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
        Mapping::set(pool_deposits, pool_id, current_deposits + amount);

        let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
        Mapping::set(pool_shares, pool_id, current_shares + amount);
    }

    async transition withdraw(
        lp_token: LPToken,
        public token_id: field,
    ) -> Future {
        assert_eq(lp_token.owner, self.signer);
        let transfer: Future = token_registry.aleo/transfer_public(token_id, self.signer, lp_token.deposit_amount as u128);

        return finalize_withdraw(
            transfer,
            lp_token.pool_id,
            lp_token.shares,
            lp_token.deposit_amount,
        );
    }

    async function finalize_withdraw(
        transfer: Future,
        pool_id: u8,
        shares: u64,
        deposit_amount: u64,
    ) {
        let current_deposits: u64 = Mapping::get_or_use(pool_deposits, pool_id, 0u64);
        let new_deposits: u64 = current_deposits > deposit_amount ?
            current_deposits - deposit_amount : 0u64;
        Mapping::set(pool_deposits, pool_id, new_deposits);

        let current_shares: u64 = Mapping::get_or_use(pool_shares, pool_id, 0u64);
        let new_shares: u64 = current_shares > shares ?
            current_shares - shares : 0u64;
        Mapping::set(pool_shares, pool_id, new_shares);
        transfer.await();
    }

    async transition claim_fees(
        lp_token: LPToken,
        public token_id: field,
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

        let transfer: Future = token_registry.aleo/transfer_public(token_id, self.signer, fee_amount as u128);
        return (returned_lp, receipt, finalize_claim_fees(transfer, lp_token.pool_id, fee_amount));
    }

    async function finalize_claim_fees(
        transfer: Future,
        pool_id: u8,
        fee_amount: u64,
    ) {
        let current_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
        let new_fees: u64 = current_fees > fee_amount ? current_fees - fee_amount : 0u64;
        Mapping::set(pool_fees, pool_id, new_fees);
        transfer.await();
    }

    async transition collect_fee(
        public pool_id: u8,
        public notional_size: u64,
    ) -> Future {
        let fee: u64 = (notional_size * 6u64) / 10000u64;
        return finalize_collect_fee(pool_id, fee);
    }

    async function finalize_collect_fee(
        pool_id: u8,
        fee: u64,
    ) {
        let current_fees: u64 = Mapping::get_or_use(pool_fees, pool_id, 0u64);
        Mapping::set(pool_fees, pool_id, current_fees + fee);
    }
}
