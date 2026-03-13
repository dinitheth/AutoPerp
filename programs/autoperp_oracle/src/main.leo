// AutoPerp Oracle - Price Feed Management
// Handles: update_price, get_mark_price, funding_rate
// Visibility: Oracle prices are public (required for mark price calculation)
// Precision: All prices use 8 decimal places (1 USD = 100_000_000u64)

program autoperp_oracle.aleo {

    // ==================== Constructor ====================

    @noupgrade
    async constructor() {}

    // ==================== Structs ====================

    struct PriceData {
        price: u64,           // 8 decimal precision
        timestamp: u32,       // Block height of update
        confidence: u64,      // Price confidence interval (8 decimals)
    }

    // ==================== Mappings ====================

    // Latest price for each market: market_id -> price (8 decimals)
    mapping prices: u8 => u64;

    // Price timestamps: market_id -> last update block height
    mapping price_timestamps: u8 => u32;

    // Price confidence: market_id -> confidence interval
    mapping price_confidence: u8 => u64;

    // Mark price (TWAP-adjusted): market_id -> mark_price
    mapping mark_prices: u8 => u64;

    // Funding rate: market_id -> funding_rate (signed as u64, with flag)
    // Positive = longs pay shorts, stored as rate * 1_000_000
    mapping funding_rates: u8 => u64;

    // Funding rate direction: market_id -> 0=longs_pay, 1=shorts_pay
    mapping funding_direction: u8 => u8;

    // Oracle admin: key 0u8 -> admin address hash
    mapping oracle_admin: u8 => field;

    // ==================== Transitions ====================

    // Initialize oracle admin (one-time setup)
    async transition initialize(
        public admin: address,
    ) -> Future {
        return finalize_initialize(admin);
    }

    async function finalize_initialize(
        admin: address,
    ) {
        // Only set if not already initialized
        let exists: bool = Mapping::contains(oracle_admin, 0u8);
        assert(!exists);

        let admin_hash: field = BHP256::hash_to_field(admin);
        Mapping::set(oracle_admin, 0u8, admin_hash);
    }

    // Update price for a market (oracle feeder)
    async transition update_price(
        public market_id: u8,
        public price: u64,
        public confidence: u64,
    ) -> Future {
        // Validate inputs
        assert(market_id <= 2u8);     // Valid market
        assert(price > 0u64);         // Non-zero price
        assert(confidence > 0u64);    // Non-zero confidence

        return finalize_update_price(
            self.caller,
            market_id,
            price,
            confidence,
        );
    }

    async function finalize_update_price(
        caller: address,
        market_id: u8,
        price: u64,
        confidence: u64,
    ) {
        // Verify caller is oracle admin
        let admin_hash: field = Mapping::get(oracle_admin, 0u8);
        let caller_hash: field = BHP256::hash_to_field(caller);
        assert_eq(admin_hash, caller_hash);

        // Update price
        Mapping::set(prices, market_id, price);

        // Update timestamp
        Mapping::set(price_timestamps, market_id, block.height);

        // Update confidence
        Mapping::set(price_confidence, market_id, confidence);
    }

    // Calculate and update mark price (TWAP-based)
    // mark_price = (oracle_price * 7 + last_mark_price * 3) / 10
    async transition update_mark_price(
        public market_id: u8,
    ) -> Future {
        assert(market_id <= 2u8);

        return finalize_update_mark_price(market_id);
    }

    async function finalize_update_mark_price(
        market_id: u8,
    ) {
        let oracle_price: u64 = Mapping::get(prices, market_id);
        let last_mark: u64 = Mapping::get_or_use(mark_prices, market_id, oracle_price);

        // TWAP: 70% oracle, 30% last mark
        let new_mark: u64 = (oracle_price * 7u64 + last_mark * 3u64) / 10u64;
        Mapping::set(mark_prices, market_id, new_mark);
    }

    // Update funding rate based on mark vs oracle price divergence
    // funding_rate = (mark_price - oracle_price) / oracle_price * 1_000_000
    async transition update_funding_rate(
        public market_id: u8,
    ) -> Future {
        assert(market_id <= 2u8);

        return finalize_update_funding_rate(market_id);
    }

    async function finalize_update_funding_rate(
        market_id: u8,
    ) {
        let oracle_price: u64 = Mapping::get(prices, market_id);
        let mark_price: u64 = Mapping::get_or_use(mark_prices, market_id, oracle_price);

        // Determine direction and calculate absolute rate
        let rate: u64 = mark_price > oracle_price ?
            ((mark_price - oracle_price) * 1000000u64) / oracle_price :
            ((oracle_price - mark_price) * 1000000u64) / oracle_price;

        let direction: u8 = mark_price > oracle_price ? 0u8 : 1u8;

        Mapping::set(funding_rates, market_id, rate);
        Mapping::set(funding_direction, market_id, direction);
    }
}
