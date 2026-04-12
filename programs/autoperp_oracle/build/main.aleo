program autoperp_oracle_v2.aleo;

mapping prices:
    key as u8.public;
    value as u64.public;

mapping price_timestamps:
    key as u8.public;
    value as u32.public;

mapping price_confidence:
    key as u8.public;
    value as u64.public;

mapping mark_prices:
    key as u8.public;
    value as u64.public;

mapping funding_rates:
    key as u8.public;
    value as u64.public;

mapping funding_direction:
    key as u8.public;
    value as u8.public;

mapping oracle_admin:
    key as u8.public;
    value as field.public;

mapping mark_timestamps:
    key as u8.public;
    value as u32.public;

function initialize:
    input r0 as address.public;
    async initialize r0 into r1;
    output r1 as autoperp_oracle_v2.aleo/initialize.future;

finalize initialize:
    input r0 as address.public;
    contains oracle_admin[0u8] into r1;
    not r1 into r2;
    assert.eq r2 true;
    hash.bhp256 r0 into r3 as field;
    set r3 into oracle_admin[0u8];

function update_price:
    input r0 as u8.public;
    input r1 as u64.public;
    input r2 as u64.public;
    lte r0 2u8 into r3;
    assert.eq r3 true;
    gt r1 0u64 into r4;
    assert.eq r4 true;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    async update_price self.caller r0 r1 r2 into r6;
    output r6 as autoperp_oracle_v2.aleo/update_price.future;

finalize update_price:
    input r0 as address.public;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    get oracle_admin[0u8] into r4;
    hash.bhp256 r0 into r5 as field;
    assert.eq r4 r5;
    set r2 into prices[r1];
    set block.height into price_timestamps[r1];
    set r3 into price_confidence[r1];

function update_mark_price:
    input r0 as u8.public;
    lte r0 2u8 into r1;
    assert.eq r1 true;
    async update_mark_price r0 into r2;
    output r2 as autoperp_oracle_v2.aleo/update_mark_price.future;

finalize update_mark_price:
    input r0 as u8.public;
    get prices[r0] into r1;
    get.or_use mark_prices[r0] r1 into r2;
    mul r1 7u64 into r3;
    mul r2 3u64 into r4;
    add r3 r4 into r5;
    div r5 10u64 into r6;
    set r6 into mark_prices[r0];
    set block.height into mark_timestamps[r0];

function update_funding_rate:
    input r0 as u8.public;
    lte r0 2u8 into r1;
    assert.eq r1 true;
    async update_funding_rate r0 into r2;
    output r2 as autoperp_oracle_v2.aleo/update_funding_rate.future;

finalize update_funding_rate:
    input r0 as u8.public;
    get prices[r0] into r1;
    get.or_use mark_prices[r0] r1 into r2;
    gt r2 r1 into r3;
    sub r2 r1 into r4;
    mul r4 1000000u64 into r5;
    div r5 r1 into r6;
    sub r1 r2 into r7;
    mul r7 1000000u64 into r8;
    div r8 r1 into r9;
    ternary r3 r6 r9 into r10;
    ternary r3 0u8 1u8 into r11;
    set r10 into funding_rates[r0];
    set r11 into funding_direction[r0];

constructor:
    assert.eq edition 0u16;
