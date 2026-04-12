import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import autoperp_oracle_v2.aleo;
program autoperp_core_v9.aleo;

record PositionRecord:
    owner as address.private;
    position_id as u64.private;
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
    position_id as u64.private;
    market_id as u8.private;
    direction as u8.private;
    size as u64.private;
    entry_price as u64.private;
    liquidation_price as u64.private;

record LPToken:
    owner as address.private;
    pool_id as u8.private;
    shares as u64.private;
    deposit_amount as u64.private;

record FeeReceipt:
    owner as address.private;
    pool_id as u8.private;
    claimed_amount as u64.private;

record ClaimableFeeEstimate:
    owner as address.private;
    pool_id as u8.private;
    estimated_fees as u64.private;

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

mapping pool_deposits:
    key as u8.public;
    value as u64.public;

mapping pool_shares:
    key as u8.public;
    value as u64.public;

mapping pool_fees:
    key as u8.public;
    value as u64.public;

mapping open_interest:
    key as u8.public;
    value as u64.public;

mapping position_count:
    key as u8.public;
    value as u64.public;

mapping next_position_id:
    key as u8.public;
    value as u64.public;

function deposit_collateral:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    cast r0 into r2 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer autoperp_core_v9.aleo r2 into r3;
    async deposit_collateral r3 self.signer r0 into r4;
    output r4 as autoperp_core_v9.aleo/deposit_collateral.future;

finalize deposit_collateral:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    input r1 as address.public;
    input r2 as u64.public;
    await r0;
    get.or_use vault[r1] 0u64 into r3;
    add r3 r2 into r4;
    set r4 into vault[r1];

function withdraw_collateral:
    input r0 as u64.public;
    gt r0 0u64 into r1;
    assert.eq r1 true;
    cast r0 into r2 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public self.signer r2 into r3;
    async withdraw_collateral r3 self.signer r0 into r4;
    output r4 as autoperp_core_v9.aleo/withdraw_collateral.future;

finalize withdraw_collateral:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as address.public;
    input r2 as u64.public;
    await r0;
    get.or_use vault[r1] 0u64 into r3;
    gte r3 r2 into r4;
    assert.eq r4 true;
    sub r3 r2 into r5;
    set r5 into vault[r1];

function open_position:
    input r0 as PositionParams.public;
    input r1 as address.public;
    input r2 as u64.public;
    lte r0.market_id 2u8 into r3;
    assert.eq r3 true;
    lte r0.direction 1u8 into r4;
    assert.eq r4 true;
    gt r0.collateral 0u64 into r5;
    assert.eq r5 true;
    gte r0.leverage 1u64 into r6;
    assert.eq r6 true;
    lte r0.leverage 50u64 into r7;
    assert.eq r7 true;
    mul r0.collateral r0.leverage into r8;
    mul r8 6u64 into r9;
    div r9 10000u64 into r10;
    sub r0.collateral r10 into r11;
    gt r11 0u64 into r12;
    assert.eq r12 true;
    mul r11 r0.leverage into r13;
    is.eq r0.direction 0u8 into r14;
    gt r0.stop_loss 0u64 into r15;
    lt r0.stop_loss r0.entry_price into r16;
    and r14 r15 into r17;
    not r17 into r18;
    or r16 r18 into r19;
    assert.eq r19 true;
    gt r0.take_profit 0u64 into r20;
    gt r0.take_profit r0.entry_price into r21;
    and r14 r20 into r22;
    not r22 into r23;
    or r21 r23 into r24;
    assert.eq r24 true;
    not r14 into r25;
    gt r0.stop_loss 0u64 into r26;
    gt r0.stop_loss r0.entry_price into r27;
    and r25 r26 into r28;
    not r28 into r29;
    or r27 r29 into r30;
    assert.eq r30 true;
    gt r0.take_profit 0u64 into r31;
    lt r0.take_profit r0.entry_price into r32;
    and r25 r31 into r33;
    not r33 into r34;
    or r32 r34 into r35;
    assert.eq r35 true;
    mul r0.entry_price 9u64 into r36;
    mul r0.leverage 10u64 into r37;
    div r36 r37 into r38;
    is.eq r0.direction 0u8 into r39;
    sub r0.entry_price r38 into r40;
    add r0.entry_price r38 into r41;
    ternary r39 r40 r41 into r42;
    cast r1 r2 r0.market_id r0.direction r11 r0.leverage r0.entry_price r13 r0.stop_loss r0.take_profit into r43 as PositionRecord.record;
    cast r1 r2 r0.market_id r0.direction r13 r0.entry_price r42 into r44 as LiquidationAuth.record;
    async open_position r0 r1 r10 r13 r2 into r45;
    output r43 as PositionRecord.record;
    output r44 as LiquidationAuth.record;
    output r45 as autoperp_core_v9.aleo/open_position.future;

finalize open_position:
    input r0 as PositionParams.public;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    get.or_use autoperp_oracle_v2.aleo/prices[r0.market_id] 0u64 into r5;
    gt r5 0u64 into r6;
    assert.eq r6 true;
    gt r0.entry_price r5 into r7;
    sub r0.entry_price r5 into r8;
    sub r5 r0.entry_price into r9;
    ternary r7 r8 r9 into r10;
    div r5 100u64 into r11;
    lte r10 r11 into r12;
    assert.eq r12 true;
    get.or_use vault[r1] 0u64 into r13;
    gte r13 r0.collateral into r14;
    assert.eq r14 true;
    sub r13 r0.collateral into r15;
    set r15 into vault[r1];
    get.or_use pool_fees[r0.market_id] 0u64 into r16;
    add r16 r2 into r17;
    set r17 into pool_fees[r0.market_id];
    get.or_use open_interest[r0.market_id] 0u64 into r18;
    add r18 r3 into r19;
    set r19 into open_interest[r0.market_id];
    get.or_use position_count[r0.market_id] 0u64 into r20;
    add r20 1u64 into r21;
    set r21 into position_count[r0.market_id];
    get.or_use next_position_id[r0.market_id] 1u64 into r22;
    assert.eq r4 r22;
    add r22 1u64 into r23;
    set r23 into next_position_id[r0.market_id];

function close_position:
    input r0 as PositionRecord.record;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as u8.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r4;
    assert.eq r4 true;
    is.eq r0.direction 0u8 into r5;
    gt r1 r0.entry_price into r6;
    gt r0.entry_price r1 into r7;
    ternary r5 r6 r7 into r8;
    gt r1 r0.entry_price into r9;
    sub r1 r0.entry_price into r10;
    sub r0.entry_price r1 into r11;
    ternary r9 r10 r11 into r12;
    mul r0.size r12 into r13;
    div r13 r0.entry_price into r14;
    add r0.collateral r14 into r15;
    gt r0.collateral r14 into r16;
    sub r0.collateral r14 into r17;
    ternary r16 r17 0u64 into r18;
    ternary r8 r15 r18 into r19;
    mul r0.size r2 into r20;
    div r20 1000000u64 into r21;
    is.eq r0.direction r3 into r22;
    gt r19 r21 into r23;
    sub r19 r21 into r24;
    ternary r23 r24 0u64 into r25;
    add r19 r21 into r26;
    ternary r22 r25 r26 into r27;
    cast r27 into r28 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public r0.owner r28 into r29;
    async close_position r29 r0.market_id r1 r2 r3 r8 r27 r0.collateral r22 r21 r0.size into r30;
    output r30 as autoperp_core_v9.aleo/close_position.future;

finalize close_position:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u8.public;
    input r5 as boolean.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as boolean.public;
    input r9 as u64.public;
    input r10 as u64.public;
    await r0;
    get autoperp_oracle_v2.aleo/prices[r1] into r11;
    gt r2 r11 into r12;
    sub r2 r11 into r13;
    sub r11 r2 into r14;
    ternary r12 r13 r14 into r15;
    div r11 100u64 into r16;
    lte r15 r16 into r17;
    assert.eq r17 true;
    get.or_use autoperp_oracle_v2.aleo/funding_rates[r1] 0u64 into r18;
    get.or_use autoperp_oracle_v2.aleo/funding_direction[r1] 0u8 into r19;
    assert.eq r3 r18;
    assert.eq r4 r19;
    get.or_use pool_balance[r1] 0u64 into r20;
    branch.eq r5 false to end_then_0_0;
    gt r6 r7 into r21;
    sub r6 r7 into r22;
    ternary r21 r22 0u64 into r23;
    gt r20 r23 into r24;
    sub r20 r23 into r25;
    ternary r24 r25 0u64 into r26;
    add r26 r9 into r27;
    gt r26 r9 into r28;
    sub r26 r9 into r29;
    ternary r28 r29 0u64 into r30;
    ternary r8 r27 r30 into r31;
    set r31 into pool_balance[r1];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    gt r7 r6 into r32;
    sub r7 r6 into r33;
    ternary r32 r33 0u64 into r34;
    add r20 r34 into r35;
    add r35 r9 into r36;
    gt r35 r9 into r37;
    sub r35 r9 into r38;
    ternary r37 r38 0u64 into r39;
    ternary r8 r36 r39 into r40;
    set r40 into pool_balance[r1];
    position end_otherwise_0_1;
    get.or_use open_interest[r1] 0u64 into r41;
    gt r41 r10 into r42;
    sub r41 r10 into r43;
    ternary r42 r43 0u64 into r44;
    set r44 into open_interest[r1];
    get.or_use position_count[r1] 0u64 into r45;
    gt r45 0u64 into r46;
    sub r45 1u64 into r47;
    ternary r46 r47 0u64 into r48;
    set r48 into position_count[r1];

function deposit_liquidity:
    input r0 as u8.public;
    input r1 as u64.public;
    input r2 as u64.public;
    lte r0 2u8 into r3;
    assert.eq r3 true;
    gt r1 0u64 into r4;
    assert.eq r4 true;
    gt r2 0u64 into r5;
    assert.eq r5 true;
    cast self.signer r0 r2 r1 into r6 as LPToken.record;
    cast r1 into r7 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer autoperp_core_v9.aleo r7 into r8;
    async deposit_liquidity r8 r0 r1 r2 into r9;
    output r6 as LPToken.record;
    output r9 as autoperp_core_v9.aleo/deposit_liquidity.future;

finalize deposit_liquidity:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    await r0;
    get.or_use pool_balance[r1] 0u64 into r4;
    get.or_use pool_shares[r1] 0u64 into r5;
    gt r4 0u64 into r6;
    gt r5 0u64 into r7;
    and r6 r7 into r8;
    branch.eq r8 false to end_then_0_2;
    mul r2 r5 into r9;
    div r9 r4 into r10;
    assert.eq r3 r10;
    branch.eq true true to end_otherwise_0_3;
    position end_then_0_2;
    assert.eq r3 r2;
    position end_otherwise_0_3;
    add r4 r2 into r11;
    set r11 into pool_balance[r1];
    get.or_use pool_deposits[r1] 0u64 into r12;
    add r12 r2 into r13;
    set r13 into pool_deposits[r1];
    add r5 r3 into r14;
    set r14 into pool_shares[r1];

function withdraw_liquidity:
    input r0 as LPToken.record;
    assert.eq r0.owner self.signer;
    cast r0.deposit_amount into r1 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public r0.owner r1 into r2;
    async withdraw_liquidity r2 r0.pool_id r0.deposit_amount r0.shares into r3;
    output r3 as autoperp_core_v9.aleo/withdraw_liquidity.future;

finalize withdraw_liquidity:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    await r0;
    get.or_use pool_balance[r1] 0u64 into r4;
    gt r4 r2 into r5;
    sub r4 r2 into r6;
    ternary r5 r6 0u64 into r7;
    set r7 into pool_balance[r1];
    get.or_use pool_deposits[r1] 0u64 into r8;
    gt r8 r2 into r9;
    sub r8 r2 into r10;
    ternary r9 r10 0u64 into r11;
    set r11 into pool_deposits[r1];
    get.or_use pool_shares[r1] 0u64 into r12;
    gt r12 r3 into r13;
    sub r12 r3 into r14;
    ternary r13 r14 0u64 into r15;
    set r15 into pool_shares[r1];

function claim_fees:
    input r0 as LPToken.record;
    input r1 as u64.public;
    input r2 as u64.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r3;
    assert.eq r3 true;
    mul r0.shares r2 into r4;
    div r4 r1 into r5;
    cast r0.owner r0.pool_id r0.shares r0.deposit_amount into r6 as LPToken.record;
    cast r0.owner r0.pool_id r5 into r7 as FeeReceipt.record;
    cast r5 into r8 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public r0.owner r8 into r9;
    async claim_fees r9 r0.pool_id r1 r2 r5 into r10;
    output r6 as LPToken.record;
    output r7 as FeeReceipt.record;
    output r10 as autoperp_core_v9.aleo/claim_fees.future;

finalize claim_fees:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u64.public;
    await r0;
    get.or_use pool_shares[r1] 0u64 into r5;
    assert.eq r5 r2;
    get.or_use pool_fees[r1] 0u64 into r6;
    assert.eq r6 r3;
    gt r6 r4 into r7;
    sub r6 r4 into r8;
    ternary r7 r8 0u64 into r9;
    set r9 into pool_fees[r1];

function estimate_claimable_fees:
    input r0 as LPToken.record;
    input r1 as u64.public;
    input r2 as u64.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r3;
    mul r0.shares r2 into r4;
    div r4 r1 into r5;
    ternary r3 r5 0u64 into r6;
    cast r0.owner r0.pool_id r6 into r7 as ClaimableFeeEstimate.record;
    output r7 as ClaimableFeeEstimate.record;

constructor:
    assert.eq edition 0u16;
