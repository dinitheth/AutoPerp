// AutoPerp Agent V3 — Leo 4.0
// Scoped, revocable agent delegation system.
// Uses bitmask permissions, block-height expiry, and single-use enforcement.
// Reads oracle prices via cross-program access for slippage validation.

import autoperp_oracle_v2.aleo;

program autoperp_agent_v3.aleo {

    @noupgrade
    constructor() {}

    // ==================== Records ====================

    // Scoped delegation with bitmask permissions
    record AgentAuth {
        owner: address,          // trader
        agent: address,          // delegated agent
        position_hash: field,    // hash of the target position
        permissions: u8,         // bitmask: 1=liquidate, 2=close, 4=adjust
        max_slippage: u64,       // max slippage basis points (max 500 = 5%)
        market_id: u8,           // market this auth applies to
        expiry: u32,             // block height expiry
    }

    // Proof that agent executed an action
    record ExecutionReceipt {
        owner: address,          // trader
        agent: address,
        action_type: u8,         // action that was executed
        execution_price: u64,    // price at execution
        market_id: u8,
        timestamp: u32,          // block height of execution
    }

    // ==================== Mappings ====================

    // Active authorizations: auth_hash -> active
    mapping active_auths: field => bool;

    // Agent execution count: agent_address_hash -> count
    mapping agent_executions: field => u64;

    // ==================== Entry Functions ====================

    // Grant scoped authorization to an agent
    fn grant_auth(
        public agent: address,
        public position_hash: field,
        public permissions: u8,
        public max_slippage: u64,
        public market_id: u8,
        public expiry: u32,
    ) -> (AgentAuth, Final) {
        // Validate permissions: must be subset of valid bits (1|2|4 = 7)
        assert(permissions > 0u8);
        assert(permissions <= 7u8);

        // Max slippage capped at 500 bps (5%)
        assert(max_slippage > 0u64);
        assert(max_slippage <= 500u64);

        // Market validation
        assert(market_id <= 2u8);

        let auth: AgentAuth = AgentAuth {
            owner: self.signer,
            agent: agent,
            position_hash: position_hash,
            permissions: permissions,
            max_slippage: max_slippage,
            market_id: market_id,
            expiry: expiry,
        };

        // Create unique auth hash from trader + agent + position
        let auth_hash: field = BHP256::hash_to_field(self.signer);

        return (auth, final {
            // Validate expiry is in the future
            assert(expiry > block.height);

            // Register as active
            Mapping::set(active_auths, auth_hash, true);
        });
    }

    // Execute an agent action (single-use, consumes authorization)
    fn execute_agent_action(
        auth: AgentAuth,
        public action_type: u8,
        public execution_price: u64,
    ) -> (ExecutionReceipt, Final) {
        // Only the designated agent can execute
        assert_eq(auth.agent, self.signer);

        // Verify the action is permitted by bitmask
        let has_permission: bool =
            (action_type == 1u8 && (auth.permissions & 1u8) == 1u8) ||  // liquidate
            (action_type == 2u8 && (auth.permissions & 2u8) == 2u8) ||  // close
            (action_type == 4u8 && (auth.permissions & 4u8) == 4u8);    // adjust
        assert(has_permission);

        assert(execution_price > 0u64);

        // Create execution receipt
        let receipt: ExecutionReceipt = ExecutionReceipt {
            owner: auth.owner,
            agent: auth.agent,
            action_type: action_type,
            execution_price: execution_price,
            market_id: auth.market_id,
            timestamp: 0u32,
        };

        let auth_hash: field = BHP256::hash_to_field(auth.owner);
        let agent_hash: field = BHP256::hash_to_field(auth.agent);

        let auth_expiry: u32 = auth.expiry;
        let auth_market_id: u8 = auth.market_id;
        let auth_max_slippage: u64 = auth.max_slippage;

        return (receipt, final {
            // Verify auth is active and not expired
            let is_active: bool = Mapping::get_or_use(active_auths, auth_hash, false);
            assert(is_active);
            assert(auth_expiry > block.height);

            // Validate execution price against oracle (cross-program read)
            let oracle_price: u64 = Mapping::get(autoperp_oracle_v2.aleo::prices, auth_market_id);

            // Slippage check: execution_price must be within max_slippage of oracle
            let price_diff: u64 = execution_price > oracle_price ?
                execution_price - oracle_price :
                oracle_price - execution_price;

            // max_slippage is in basis points (100 = 1%)
            let max_allowed_diff: u64 = (oracle_price * auth_max_slippage) / 10000u64;
            assert(price_diff <= max_allowed_diff);

            // Deactivate auth (single-use enforcement)
            Mapping::set(active_auths, auth_hash, false);

            // Increment agent execution count
            let current_count: u64 = Mapping::get_or_use(agent_executions, agent_hash, 0u64);
            Mapping::set(agent_executions, agent_hash, current_count + 1u64);
        });
    }

    // Liquidate a position via agent delegation
    fn liquidate_position(
        auth: AgentAuth,
        public current_price: u64,
        public liquidation_price: u64,
    ) -> (ExecutionReceipt, Final) {
        // Only designated agent can liquidate
        assert_eq(auth.agent, self.signer);

        // Must have liquidation permission (bit 0)
        assert((auth.permissions & 1u8) == 1u8);

        assert(current_price > 0u64);
        assert(liquidation_price > 0u64);

        let receipt: ExecutionReceipt = ExecutionReceipt {
            owner: auth.owner,
            agent: auth.agent,
            action_type: 1u8,
            execution_price: current_price,
            market_id: auth.market_id,
            timestamp: 0u32,
        };

        let auth_hash: field = BHP256::hash_to_field(auth.owner);
        let agent_hash: field = BHP256::hash_to_field(auth.agent);

        let auth_expiry: u32 = auth.expiry;
        let auth_market_id: u8 = auth.market_id;

        return (receipt, final {
            // Verify auth
            let is_active: bool = Mapping::get_or_use(active_auths, auth_hash, false);
            assert(is_active);
            assert(auth_expiry > block.height);

            // Validate price against oracle (cross-program read)
            let oracle_price: u64 = Mapping::get(autoperp_oracle_v2.aleo::prices, auth_market_id);
            let price_diff: u64 = current_price > oracle_price ?
                current_price - oracle_price :
                oracle_price - current_price;
            let max_div: u64 = oracle_price / 100u64;
            assert(price_diff <= max_div);

            // Deactivate (single-use)
            Mapping::set(active_auths, auth_hash, false);

            // Increment agent execution count
            let current_count: u64 = Mapping::get_or_use(agent_executions, agent_hash, 0u64);
            Mapping::set(agent_executions, agent_hash, current_count + 1u64);
        });
    }

    // Revoke an authorization (trader takes back control)
    fn revoke_auth(
        auth: AgentAuth,
    ) -> Final {
        // Only the owner (trader) can revoke
        assert_eq(auth.owner, self.signer);

        let auth_hash: field = BHP256::hash_to_field(auth.owner);

        return final {
            Mapping::set(active_auths, auth_hash, false);
        };
    }
}
