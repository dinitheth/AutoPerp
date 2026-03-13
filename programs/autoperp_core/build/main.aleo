program autoperp_core_v2.aleo;

record PositionRecord:
    owner as address.private;
    position_id as field.private;
    market_id as u8.private;
    direction as u8.private;
    collateral as u64.private;
    leverage as u64.private;
    entry_price as u64.private;
    size as u64.private;
    stop_loss as u64.private;
    take_profit as u64.private;

record LiquidationAuth:
    owner as address.private;
    position_id as field.private;
    trader as address.private;
    liquidation_price as u64.private;
    market_id as u8.private;
    direction as u8.private;

struct PositionParams:
    market_id as u8;
    direction as u8;
    collateral as u64;
    leverage as u64;
    entry_price as u64;
    stop_loss as u64;
    take_profit as u64;

mapping vault:
    key as address.public;
    value as u64.public;

mapping pool_balance:
    key as u8.public;
    value as u64.public;

mapping position_commitments:
    key as field.public;
    value as boolean.public;

mapping open_interest:
    key as u8.public;
    value as u64.public;

mapping position_count:
    key as u8.public;
    value as u64.public;

function open_position:
    input r0 as PositionParams.private;
    input r1 as address.public;
    lte r0.market_id 2u8 into r2;
    assert.eq r2 true;
    lte r0.direction 1u8 into r3;
    assert.eq r3 true;
    gt r0.collateral 0u64 into r4;
    assert.eq r4 true;
    gte r0.leverage 1u64 into r5;
    assert.eq r5 true;
    lte r0.leverage 50u64 into r6;
    assert.eq r6 true;
    gt r0.entry_price 0u64 into r7;
    assert.eq r7 true;
    mul r0.collateral r0.leverage into r8;
    mul r8 6u64 into r9;
    div r9 10000u64 into r10;
    sub r0.collateral r10 into r11;
    mul r0.entry_price 90u64 into r12;
    mul r0.leverage 100u64 into r13;
    div r12 r13 into r14;
    is.eq r0.direction 0u8 into r15;
    sub r0.entry_price r14 into r16;
    add r0.entry_price r14 into r17;
    ternary r15 r16 r17 into r18;
    hash.bhp256 r0 into r19 as field;
    hash.bhp256 r19 into r20 as field;
    cast self.caller r19 r0.market_id r0.direction r11 r0.leverage r0.entry_price r8 r0.stop_loss r0.take_profit into r21 as PositionRecord.record;
    cast r1 r19 self.caller r18 r0.market_id r0.direction into r22 as LiquidationAuth.record;
    async open_position self.caller r0.collateral r10 r20 r0.market_id r8 into r23;
    output r21 as PositionRecord.record;
    output r22 as LiquidationAuth.record;
    output r23 as autoperp_core_v2.aleo/open_position.future;

finalize open_position:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as field.public;
    input r4 as u8.public;
    input r5 as u64.public;
    get vault[r0] into r6;
    gte r6 r1 into r7;
    assert.eq r7 true;
    sub r6 r1 into r8;
    set r8 into vault[r0];
    sub r1 r2 into r9;
    get.or_use pool_balance[0u8] 0u64 into r10;
    add r10 r9 into r11;
    set r11 into pool_balance[0u8];
    set true into position_commitments[r3];
    get.or_use open_interest[r4] 0u64 into r12;
    add r12 r5 into r13;
    set r13 into open_interest[r4];
    get.or_use position_count[0u8] 0u64 into r14;
    add r14 1u64 into r15;
    set r15 into position_count[0u8];

function deposit_collateral:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    async deposit_collateral self.caller r0 into r2;
    output r2 as autoperp_core_v2.aleo/deposit_collateral.future;

finalize deposit_collateral:
    input r0 as address.public;
    input r1 as u64.public;
    get.or_use vault[r0] 0u64 into r2;
    add r2 r1 into r3;
    set r3 into vault[r0];

function close_position:
    input r0 as PositionRecord.record;
    input r1 as u64.public;
    assert.eq r0.owner self.caller;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    hash.bhp256 r0.position_id into r3 as field;
    async close_position r0.owner r0.market_id r0.direction r0.size r0.collateral r0.entry_price r1 r3 into r4;
    output r4 as autoperp_core_v2.aleo/close_position.future;

finalize close_position:
    input r0 as address.public;
    input r1 as u8.public;
    input r2 as u8.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as u64.public;
    input r6 as u64.public;
    input r7 as field.public;
    get.or_use pool_balance[0u8] 0u64 into r8;
    is.eq r2 0u8 into r9;
    gte r6 r5 into r10;
    and r9 r10 into r11;
    is.eq r2 1u8 into r12;
    lte r6 r5 into r13;
    and r12 r13 into r14;
    or r11 r14 into r15;
    sub r6 r5 into r16;
    ternary r11 r16 0u64 into r17;
    lt r6 r5 into r18;
    and r9 r18 into r19;
    sub r5 r6 into r20;
    ternary r19 r20 0u64 into r21;
    ternary r14 r20 0u64 into r22;
    gt r6 r5 into r23;
    and r12 r23 into r24;
    ternary r24 r16 0u64 into r25;
    add r17 r21 into r26;
    add r26 r22 into r27;
    add r27 r25 into r28;
    mul r3 r28 into r29;
    div r29 r5 into r30;
    gt r30 r8 into r31;
    ternary r31 r8 r30 into r32;
    gt r30 r4 into r33;
    ternary r33 r4 r30 into r34;
    add r4 r32 into r35;
    gt r4 r34 into r36;
    sub r4 r34 into r37;
    ternary r36 r37 0u64 into r38;
    ternary r15 r35 r38 into r39;
    sub r4 r39 into r40;
    ternary r15 0u64 r40 into r41;
    gt r8 r32 into r42;
    sub r8 r32 into r43;
    ternary r42 r43 0u64 into r44;
    add r8 r41 into r45;
    ternary r15 r44 r45 into r46;
    set r46 into pool_balance[0u8];
    get.or_use vault[r0] 0u64 into r47;
    add r47 r39 into r48;
    set r48 into vault[r0];
    set false into position_commitments[r7];
    get.or_use open_interest[r1] 0u64 into r49;
    gt r49 r3 into r50;
    sub r49 r3 into r51;
    ternary r50 r51 0u64 into r52;
    set r52 into open_interest[r1];

function withdraw_collateral:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    async withdraw_collateral self.caller r0 into r2;
    output r2 as autoperp_core_v2.aleo/withdraw_collateral.future;

finalize withdraw_collateral:
    input r0 as address.public;
    input r1 as u64.public;
    get vault[r0] into r2;
    gte r2 r1 into r3;
    assert.eq r3 true;
    sub r2 r1 into r4;
    set r4 into vault[r0];

function lp_deposit:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    async lp_deposit r0 into r2;
    output r2 as autoperp_core_v2.aleo/lp_deposit.future;

finalize lp_deposit:
    input r0 as u64.public;
    get.or_use pool_balance[0u8] 0u64 into r1;
    add r1 r0 into r2;
    set r2 into pool_balance[0u8];

function adjust_leverage:
    input r0 as PositionRecord.record;
    input r1 as u64.private;
    assert.eq r0.owner self.caller;
    gte r1 1u64 into r2;
    assert.eq r2 true;
    lte r1 50u64 into r3;
    assert.eq r3 true;
    mul r0.collateral r1 into r4;
    cast r0.owner r0.position_id r0.market_id r0.direction r0.collateral r1 r0.entry_price r4 r0.stop_loss r0.take_profit into r5 as PositionRecord.record;
    output r5 as PositionRecord.record;

function update_risk_params:
    input r0 as PositionRecord.record;
    input r1 as u64.private;
    input r2 as u64.private;
    assert.eq r0.owner self.caller;
    cast r0.owner r0.position_id r0.market_id r0.direction r0.collateral r0.leverage r0.entry_price r0.size r1 r2 into r3 as PositionRecord.record;
    output r3 as PositionRecord.record;

constructor:
    assert.eq edition 0u16;
