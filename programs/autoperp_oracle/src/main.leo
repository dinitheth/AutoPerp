// AutoPerp Oracle V2 — Leo 4.0
// Price Feed Management with TWAP mark pricing and divergence-based funding rates
// All prices use 8 decimal places (1 USD = 100_000_000u64)
// External programs read oracle state via external storage access (Leo 3.5+/4.0)

program autoperp_oracle_v2.aleo {

    @noupgrade
    constructor() {}

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

    // Funding rate: market_id -> funding_rate * 1_000_000
    mapping funding_rates: u8 => u64;

    // Funding direction: market_id -> 0=longs_pay, 1=shorts_pay
    mapping funding_direction: u8 => u8;

    // Oracle admin: key 0u8 -> BHP256 hash of admin address
    mapping oracle_admin: u8 => field;

    // Price staleness guard: market_id -> last mark update block height
    mapping mark_timestamps: u8 => u32;

    // ==================== Entry Functions ====================

    // Initialize oracle admin (one-time setup)
    fn initialize(
        public admin: address,
    ) -> Final {
        return final {
            let exists: bool = Mapping::contains(oracle_admin, 0u8);
            assert(!exists);
            let admin_hash: field = BHP256::hash_to_field(admin);
            Mapping::set(oracle_admin, 0u8, admin_hash);
        };
    }

    // Update price for a market (oracle feeder, admin-guarded)
    fn update_price(
        public market_id: u8,
        public price: u64,
        public confidence: u64,
    ) -> Final {
        assert(market_id <= 2u8);
        assert(price > 0u64);
        assert(confidence > 0u64);

        let caller: address = self.caller;

        return final {
            // Verify caller is oracle admin
            let admin_hash: field = Mapping::get(oracle_admin, 0u8);
            let caller_hash: field = BHP256::hash_to_field(caller);
            assert_eq(admin_hash, caller_hash);

            Mapping::set(prices, market_id, price);
            Mapping::set(price_timestamps, market_id, block.height);
            Mapping::set(price_confidence, market_id, confidence);
        };
    }

    // Calculate TWAP-blended mark price: 70% oracle + 30% last mark
    fn update_mark_price(
        public market_id: u8,
    ) -> Final {
        assert(market_id <= 2u8);

        return final {
            let oracle_price: u64 = Mapping::get(prices, market_id);
            let last_mark: u64 = Mapping::get_or_use(mark_prices, market_id, oracle_price);

            // TWAP: 70% oracle, 30% last mark
            let new_mark: u64 = (oracle_price * 7u64 + last_mark * 3u64) / 10u64;
            Mapping::set(mark_prices, market_id, new_mark);
            Mapping::set(mark_timestamps, market_id, block.height);
        };
    }

    // Update funding rate based on mark vs oracle price divergence
    // funding_rate = |mark_price - oracle_price| / oracle_price * 1_000_000
    fn update_funding_rate(
        public market_id: u8,
    ) -> Final {
        assert(market_id <= 2u8);

        return final {
            let oracle_price: u64 = Mapping::get(prices, market_id);
            let mark_price: u64 = Mapping::get_or_use(mark_prices, market_id, oracle_price);

            let rate: u64 = mark_price > oracle_price ?
                ((mark_price - oracle_price) * 1000000u64) / oracle_price :
                ((oracle_price - mark_price) * 1000000u64) / oracle_price;

            let direction: u8 = mark_price > oracle_price ? 0u8 : 1u8;

            Mapping::set(funding_rates, market_id, rate);
            Mapping::set(funding_direction, market_id, direction);
        };
    }
}
