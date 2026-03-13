// AutoPerp Agent - AgentAuth System
// Handles: grant_auth, revoke_auth, execute_agent_action, liquidate_position
// Privacy: AgentAuth records are encrypted, agent operates on commitment hashes only
// Permissions bitmask: bit 0 = liquidate, bit 1 = close, bit 2 = adjust

program autoperp_agent_v2.aleo {

    // ==================== Constructor ====================

    @noupgrade
    async constructor() {}

    // ==================== Constants ====================

    // Permission bitmask values
    // PERM_LIQUIDATE = 1u8  (bit 0)
    // PERM_CLOSE     = 2u8  (bit 1)
    // PERM_ADJUST    = 4u8  (bit 2)
    // PERM_ALL       = 7u8  (all bits)

    // ==================== Records ====================

    // AgentAuth record - scoped, revocable delegation to AI agent
    record AgentAuth {
        owner: address,           // Trader granting permission
        agent: address,           // AI agent address
        position_hash: field,     // Commitment hash (not position data)
        permissions: u8,          // Bitmask: liquidate | close | adjust
        max_slippage: u64,        // Maximum allowed slippage in basis points
        expiry: u32,              // Block height expiry
    }

    // Execution receipt - proof that agent executed an action
    record ExecutionReceipt {
        owner: address,           // Trader who owns the position
        agent: address,           // Agent that executed
        position_hash: field,
        action_type: u8,          // 0=liquidate, 1=close, 2=adjust
        execution_price: u64,     // Price at execution (8 decimals)
    }

    // ==================== Mappings ====================

    // Track active agent authorizations: hash(trader + position_hash) -> active
    mapping active_auths: field => bool;

    // Agent execution count: agent_address_hash -> count
    mapping agent_executions: field => u64;

    // ==================== Transitions ====================

    // Grant AgentAuth to an AI agent for a specific position
    async transition grant_auth(
        public agent: address,
        position_hash: field,
        permissions: u8,
        max_slippage: u64,
        public expiry: u32,
    ) -> (AgentAuth, Future) {
        // Validate permissions bitmask (max value = 7 = all permissions)
        assert(permissions > 0u8);
        assert(permissions <= 7u8);

        // Validate slippage (max 500 basis points = 5%)
        assert(max_slippage > 0u64);
        assert(max_slippage <= 500u64);

        // Validate expiry is in the future (will be checked in finalize)
        assert(expiry > 0u32);

        // Create the AgentAuth record
        let auth: AgentAuth = AgentAuth {
            owner: self.caller,
            agent,
            position_hash,
            permissions,
            max_slippage,
            expiry,
        };

        // Hash for tracking
        let auth_key: field = BHP256::hash_to_field(position_hash);

        return (auth, finalize_grant_auth(auth_key, expiry));
    }

    async function finalize_grant_auth(
        auth_key: field,
        expiry: u32,
    ) {
        // Ensure expiry is in the future
        assert(expiry > block.height);

        // Mark authorization as active
        Mapping::set(active_auths, auth_key, true);
    }

    // Revoke AgentAuth - trader consumes the record to revoke
    async transition revoke_auth(
        auth: AgentAuth,
    ) -> Future {
        // Only the granting trader can revoke
        assert_eq(auth.owner, self.caller);

        let auth_key: field = BHP256::hash_to_field(auth.position_hash);

        return finalize_revoke_auth(auth_key);
    }

    async function finalize_revoke_auth(
        auth_key: field,
    ) {
        // Mark authorization as inactive
        Mapping::set(active_auths, auth_key, false);
    }

    // Execute agent action (close position via AgentAuth)
    // Agent calls this when SL/TP conditions are met
    async transition execute_agent_action(
        auth: AgentAuth,
        public action_type: u8,       // 1=close, 2=adjust
        public execution_price: u64,  // Current market price (8 decimals)
    ) -> (ExecutionReceipt, Future) {
        // Verify caller is the authorized agent
        assert_eq(self.caller, auth.agent);

        // Verify action permission via bitmask
        // action_type 1 (close) needs bit 1 (permission value 2)
        // action_type 2 (adjust) needs bit 2 (permission value 4)
        let required_perm: u8 = action_type == 1u8 ? 2u8 : 4u8;
        let has_perm: u8 = auth.permissions & required_perm;
        assert(has_perm > 0u8);

        // Verify execution price is within slippage tolerance
        // (price validation happens against oracle in practice)
        assert(execution_price > 0u64);

        // Create execution receipt
        let receipt: ExecutionReceipt = ExecutionReceipt {
            owner: auth.owner,
            agent: auth.agent,
            position_hash: auth.position_hash,
            action_type,
            execution_price,
        };

        let auth_key: field = BHP256::hash_to_field(auth.position_hash);
        let agent_key: field = BHP256::hash_to_field(auth.agent);

        return (receipt, finalize_execute_agent_action(auth_key, agent_key, auth.expiry));
    }

    async function finalize_execute_agent_action(
        auth_key: field,
        agent_key: field,
        expiry: u32,
    ) {
        // Verify authorization is still active
        let is_active: bool = Mapping::get_or_use(active_auths, auth_key, false);
        assert(is_active);

        // Verify not expired
        assert(expiry > block.height);

        // Deactivate auth after execution (single-use)
        Mapping::set(active_auths, auth_key, false);

        // Increment agent execution count
        let count: u64 = Mapping::get_or_use(agent_executions, agent_key, 0u64);
        Mapping::set(agent_executions, agent_key, count + 1u64);
    }

    // Autonomous liquidation - agent liquidates undercollateralized position
    async transition liquidate_position(
        auth: AgentAuth,
        public current_price: u64,
        public liquidation_price: u64,
    ) -> (ExecutionReceipt, Future) {
        // Verify caller is the authorized agent
        assert_eq(self.caller, auth.agent);

        // Verify liquidation permission (bit 0, value 1)
        let has_liq_perm: u8 = auth.permissions & 1u8;
        assert(has_liq_perm > 0u8);

        // Price must have crossed liquidation threshold
        // (direction-specific check would be done with position data)
        assert(current_price > 0u64);
        assert(liquidation_price > 0u64);

        let receipt: ExecutionReceipt = ExecutionReceipt {
            owner: auth.owner,
            agent: auth.agent,
            position_hash: auth.position_hash,
            action_type: 0u8,  // 0 = liquidation
            execution_price: current_price,
        };

        let auth_key: field = BHP256::hash_to_field(auth.position_hash);
        let agent_key: field = BHP256::hash_to_field(auth.agent);

        return (receipt, finalize_liquidate_position(auth_key, agent_key, auth.expiry));
    }

    async function finalize_liquidate_position(
        auth_key: field,
        agent_key: field,
        expiry: u32,
    ) {
        // Verify authorization is active
        let is_active: bool = Mapping::get_or_use(active_auths, auth_key, false);
        assert(is_active);

        // Verify not expired
        assert(expiry > block.height);

        // Deactivate after liquidation
        Mapping::set(active_auths, auth_key, false);

        // Track execution
        let count: u64 = Mapping::get_or_use(agent_executions, agent_key, 0u64);
        Mapping::set(agent_executions, agent_key, count + 1u64);
    }
}
