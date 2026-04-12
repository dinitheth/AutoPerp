import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
import autoperp_oracle_v2.aleo;
program autoperp_core_private_v9.aleo;

record TraderVault:
    owner as address.private;
    balance as u64.private;

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

function create_vault:
    input r0 as u64.private;
    cast self.signer r0 into r1 as TraderVault.record;
    output r1 as TraderVault.record;

function deposit_collateral:
    input r0 as TraderVault.record;
    input r1 as u64.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    cast r1 into r3 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer autoperp_core_private_v9.aleo r3 into r4;
    add r0.balance r1 into r5;
    cast r0.owner r5 into r6 as TraderVault.record;
    async deposit_collateral r4 into r7;
    output r6 as TraderVault.record;
    output r7 as autoperp_core_private_v9.aleo/deposit_collateral.future;

finalize deposit_collateral:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    await r0;

function withdraw_collateral:
    input r0 as TraderVault.record;
    input r1 as u64.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r2;
    assert.eq r2 true;
    gte r0.balance r1 into r3;
    assert.eq r3 true;
    sub r0.balance r1 into r4;
    cast r0.owner r4 into r5 as TraderVault.record;
    cast r1 into r6 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r6 into r7 r8 r9;
    async withdraw_collateral r9 into r10;
    output r5 as TraderVault.record;
    output r7 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r8 as test_usdcx_stablecoin.aleo/Token.record;
    output r10 as autoperp_core_private_v9.aleo/withdraw_collateral.future;

finalize withdraw_collateral:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    await r0;

function open_position:
    input r0 as TraderVault.record;
    input r1 as PositionParams.public;
    input r2 as u64.public;
    assert.eq r0.owner self.signer;
    lte r1.market_id 2u8 into r3;
    assert.eq r3 true;
    lte r1.direction 1u8 into r4;
    assert.eq r4 true;
    gt r1.collateral 0u64 into r5;
    assert.eq r5 true;
    gte r1.leverage 1u64 into r6;
    assert.eq r6 true;
    lte r1.leverage 50u64 into r7;
    assert.eq r7 true;
    gte r0.balance r1.collateral into r8;
    assert.eq r8 true;
    mul r1.collateral r1.leverage into r9;
    mul r9 6u64 into r10;
    div r10 10000u64 into r11;
    sub r1.collateral r11 into r12;
    gt r12 0u64 into r13;
    assert.eq r13 true;
    mul r12 r1.leverage into r14;
    is.eq r1.direction 0u8 into r15;
    gt r1.stop_loss 0u64 into r16;
    lt r1.stop_loss r1.entry_price into r17;
    and r15 r16 into r18;
    not r18 into r19;
    or r17 r19 into r20;
    assert.eq r20 true;
    gt r1.take_profit 0u64 into r21;
    gt r1.take_profit r1.entry_price into r22;
    and r15 r21 into r23;
    not r23 into r24;
    or r22 r24 into r25;
    assert.eq r25 true;
    not r15 into r26;
    gt r1.stop_loss 0u64 into r27;
    gt r1.stop_loss r1.entry_price into r28;
    and r26 r27 into r29;
    not r29 into r30;
    or r28 r30 into r31;
    assert.eq r31 true;
    gt r1.take_profit 0u64 into r32;
    lt r1.take_profit r1.entry_price into r33;
    and r26 r32 into r34;
    not r34 into r35;
    or r33 r35 into r36;
    assert.eq r36 true;
    mul r1.entry_price 9u64 into r37;
    mul r1.leverage 10u64 into r38;
    div r37 r38 into r39;
    is.eq r1.direction 0u8 into r40;
    sub r1.entry_price r39 into r41;
    add r1.entry_price r39 into r42;
    ternary r40 r41 r42 into r43;
    sub r0.balance r1.collateral into r44;
    cast r0.owner r44 into r45 as TraderVault.record;
    cast r0.owner r2 r1.market_id r1.direction r12 r1.leverage r1.entry_price r14 r1.stop_loss r1.take_profit into r46 as PositionRecord.record;
    cast r0.owner r2 r1.market_id r1.direction r14 r1.entry_price r43 into r47 as LiquidationAuth.record;
    async open_position r1 r11 r14 r2 into r48;
    output r45 as TraderVault.record;
    output r46 as PositionRecord.record;
    output r47 as LiquidationAuth.record;
    output r48 as autoperp_core_private_v9.aleo/open_position.future;

finalize open_position:
    input r0 as PositionParams.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as u64.public;
    get.or_use autoperp_oracle_v2.aleo/prices[r0.market_id] 0u64 into r4;
    gt r4 0u64 into r5;
    assert.eq r5 true;
    gt r0.entry_price r4 into r6;
    ternary r6 r0.entry_price r4 into r7;
    gt r0.entry_price r4 into r8;
    ternary r8 r4 r0.entry_price into r9;
    sub r7 r9 into r10;
    div r4 20u64 into r11;
    lte r10 r11 into r12;
    assert.eq r12 true;
    get.or_use pool_fees[r0.market_id] 0u64 into r13;
    add r13 r1 into r14;
    set r14 into pool_fees[r0.market_id];
    get.or_use open_interest[r0.market_id] 0u64 into r15;
    add r15 r2 into r16;
    set r16 into open_interest[r0.market_id];
    get.or_use position_count[r0.market_id] 0u64 into r17;
    add r17 1u64 into r18;
    set r18 into position_count[r0.market_id];
    get.or_use next_position_id[r0.market_id] 1u64 into r19;
    assert.eq r3 r19;
    add r19 1u64 into r20;
    set r20 into next_position_id[r0.market_id];

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
    ternary r9 r1 r0.entry_price into r10;
    gt r1 r0.entry_price into r11;
    ternary r11 r0.entry_price r1 into r12;
    sub r10 r12 into r13;
    mul r0.size r13 into r14;
    div r14 r0.entry_price into r15;
    add r0.collateral r15 into r16;
    gt r0.collateral r15 into r17;
    sub r0.collateral r15 into r18;
    ternary r17 r18 0u64 into r19;
    ternary r8 r16 r19 into r20;
    mul r0.size r2 into r21;
    div r21 1000000u64 into r22;
    is.eq r0.direction r3 into r23;
    gt r20 r22 into r24;
    sub r20 r22 into r25;
    ternary r24 r25 0u64 into r26;
    add r20 r22 into r27;
    ternary r23 r26 r27 into r28;
    cast r28 into r29 as u128;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r29 into r30 r31 r32;
    async close_position r32 r0.market_id r1 r2 r3 r8 r28 r0.collateral r22 r23 r0.size into r33;
    output r30 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r31 as test_usdcx_stablecoin.aleo/Token.record;
    output r33 as autoperp_core_private_v9.aleo/close_position.future;

finalize close_position:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as u8.public;
    input r5 as boolean.public;
    input r6 as u64.public;
    input r7 as u64.public;
    input r8 as u64.public;
    input r9 as boolean.public;
    input r10 as u64.public;
    await r0;
    get autoperp_oracle_v2.aleo/prices[r1] into r11;
    gt r2 r11 into r12;
    ternary r12 r2 r11 into r13;
    ternary r12 r11 r2 into r14;
    sub r13 r14 into r15;
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
    ternary r24 r23 r20 into r25;
    sub r20 r25 into r26;
    gt r26 r8 into r27;
    ternary r27 r8 r26 into r28;
    add r26 r8 into r29;
    sub r26 r28 into r30;
    ternary r9 r29 r30 into r31;
    set r31 into pool_balance[r1];
    branch.eq true true to end_otherwise_0_1;
    position end_then_0_0;
    gt r7 r6 into r32;
    sub r7 r6 into r33;
    ternary r32 r33 0u64 into r34;
    add r20 r34 into r35;
    gt r35 r8 into r36;
    ternary r36 r8 r35 into r37;
    add r35 r8 into r38;
    sub r35 r37 into r39;
    ternary r9 r38 r39 into r40;
    set r40 into pool_balance[r1];
    position end_otherwise_0_1;
    get.or_use open_interest[r1] 0u64 into r41;
    gt r41 r10 into r42;
    ternary r42 r10 r41 into r43;
    sub r41 r43 into r44;
    set r44 into open_interest[r1];
    get.or_use position_count[r1] 0u64 into r45;
    gt r45 0u64 into r46;
    ternary r46 1u64 0u64 into r47;
    sub r45 r47 into r48;
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
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer autoperp_core_private_v9.aleo r7 into r8;
    async deposit_liquidity r8 r0 r1 r2 into r9;
    output r6 as LPToken.record;
    output r9 as autoperp_core_private_v9.aleo/deposit_liquidity.future;

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
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r1 into r2 r3 r4;
    async withdraw_liquidity r4 r0.pool_id r0.deposit_amount r0.shares into r5;
    output r2 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r3 as test_usdcx_stablecoin.aleo/Token.record;
    output r5 as autoperp_core_private_v9.aleo/withdraw_liquidity.future;

finalize withdraw_liquidity:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    input r1 as u8.public;
    input r2 as u64.public;
    input r3 as u64.public;
    await r0;
    get.or_use pool_balance[r1] 0u64 into r4;
    gt r4 r2 into r5;
    ternary r5 r2 r4 into r6;
    sub r4 r6 into r7;
    set r7 into pool_balance[r1];
    get.or_use pool_deposits[r1] 0u64 into r8;
    gt r8 r2 into r9;
    ternary r9 r2 r8 into r10;
    sub r8 r10 into r11;
    set r11 into pool_deposits[r1];
    get.or_use pool_shares[r1] 0u64 into r12;
    gt r12 r3 into r13;
    ternary r13 r3 r12 into r14;
    sub r12 r14 into r15;
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
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r8 into r9 r10 r11;
    async claim_fees r11 r0.pool_id r1 r2 r5 into r12;
    output r6 as LPToken.record;
    output r7 as FeeReceipt.record;
    output r9 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r10 as test_usdcx_stablecoin.aleo/Token.record;
    output r12 as autoperp_core_private_v9.aleo/claim_fees.future;

finalize claim_fees:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
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
    ternary r7 r4 r6 into r8;
    sub r6 r8 into r9;
    set r9 into pool_fees[r1];

function estimate_claimable_fees:
    input r0 as LPToken.record;
    input r1 as u64.public;
    input r2 as u64.public;
    assert.eq r0.owner self.signer;
    gt r1 0u64 into r3;
    ternary r3 r1 1u64 into r4;
    mul r0.shares r2 into r5;
    div r5 r4 into r6;
    ternary r3 r6 0u64 into r7;
    cast r0.owner r0.pool_id r7 into r8 as ClaimableFeeEstimate.record;
    output r8 as ClaimableFeeEstimate.record;

constructor:
    assert.eq edition 0u16;
