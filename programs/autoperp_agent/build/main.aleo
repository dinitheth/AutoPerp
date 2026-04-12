import autoperp_oracle_v2.aleo;
program autoperp_agent_v3.aleo;

record AgentAuth:
    owner as address.private;
    agent as address.private;
    position_hash as field.private;
    permissions as u8.private;
    max_slippage as u64.private;
    market_id as u8.private;
    expiry as u32.private;

record ExecutionReceipt:
    owner as address.private;
    agent as address.private;
    action_type as u8.private;
    execution_price as u64.private;
    market_id as u8.private;
    timestamp as u32.private;

mapping active_auths:
    key as field.public;
    value as boolean.public;

mapping agent_executions:
    key as field.public;
    value as u64.public;

function grant_auth:
    input r0 as address.public;
    input r1 as field.public;
    input r2 as u8.public;
    input r3 as u64.public;
    input r4 as u8.public;
    input r5 as u32.public;
    gt r2 0u8 into r6;
    assert.eq r6 true;
    lte r2 7u8 into r7;
    assert.eq r7 true;
    gt r3 0u64 into r8;
    assert.eq r8 true;
    lte r3 500u64 into r9;
    assert.eq r9 true;
    lte r4 2u8 into r10;
    assert.eq r10 true;
    cast self.signer r0 r1 r2 r3 r4 r5 into r11 as AgentAuth.record;
    hash.bhp256 self.signer into r12 as field;
    async grant_auth r5 r12 into r13;
    output r11 as AgentAuth.record;
    output r13 as autoperp_agent_v3.aleo/grant_auth.future;

finalize grant_auth:
    input r0 as u32.public;
    input r1 as field.public;
    gt r0 block.height into r2;
    assert.eq r2 true;
    set true into active_auths[r1];

function execute_agent_action:
    input r0 as AgentAuth.record;
    input r1 as u8.public;
    input r2 as u64.public;
    assert.eq r0.agent self.signer;
    is.eq r1 1u8 into r3;
    and r0.permissions 1u8 into r4;
    is.eq r4 1u8 into r5;
    and r3 r5 into r6;
    is.eq r1 2u8 into r7;
    and r0.permissions 2u8 into r8;
    is.eq r8 2u8 into r9;
    and r7 r9 into r10;
    or r6 r10 into r11;
    is.eq r1 4u8 into r12;
    and r0.permissions 4u8 into r13;
    is.eq r13 4u8 into r14;
    and r12 r14 into r15;
    or r11 r15 into r16;
    assert.eq r16 true;
    gt r2 0u64 into r17;
    assert.eq r17 true;
    cast r0.owner r0.agent r1 r2 r0.market_id 0u32 into r18 as ExecutionReceipt.record;
    hash.bhp256 r0.owner into r19 as field;
    hash.bhp256 r0.agent into r20 as field;
    async execute_agent_action r19 r0.expiry r0.market_id r2 r0.max_slippage r20 into r21;
    output r18 as ExecutionReceipt.record;
    output r21 as autoperp_agent_v3.aleo/execute_agent_action.future;

finalize execute_agent_action:
    input r0 as field.public;
    input r1 as u32.public;
    input r2 as u8.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as field.public;
    get.or_use active_auths[r0] false into r6;
    assert.eq r6 true;
    gt r1 block.height into r7;
    assert.eq r7 true;
    get autoperp_oracle_v2.aleo/prices[r2] into r8;
    gt r3 r8 into r9;
    sub r3 r8 into r10;
    sub r8 r3 into r11;
    ternary r9 r10 r11 into r12;
    mul r8 r4 into r13;
    div r13 10000u64 into r14;
    lte r12 r14 into r15;
    assert.eq r15 true;
    set false into active_auths[r0];
    get.or_use agent_executions[r5] 0u64 into r16;
    add r16 1u64 into r17;
    set r17 into agent_executions[r5];

function liquidate_position:
    input r0 as AgentAuth.record;
    input r1 as u64.public;
    input r2 as u64.public;
    assert.eq r0.agent self.signer;
    and r0.permissions 1u8 into r3;
    is.eq r3 1u8 into r4;
    assert.eq r4 true;
    gt r1 0u64 into r5;
    assert.eq r5 true;
    gt r2 0u64 into r6;
    assert.eq r6 true;
    cast r0.owner r0.agent 1u8 r1 r0.market_id 0u32 into r7 as ExecutionReceipt.record;
    hash.bhp256 r0.owner into r8 as field;
    hash.bhp256 r0.agent into r9 as field;
    async liquidate_position r8 r0.expiry r0.market_id r1 r9 into r10;
    output r7 as ExecutionReceipt.record;
    output r10 as autoperp_agent_v3.aleo/liquidate_position.future;

finalize liquidate_position:
    input r0 as field.public;
    input r1 as u32.public;
    input r2 as u8.public;
    input r3 as u64.public;
    input r4 as field.public;
    get.or_use active_auths[r0] false into r5;
    assert.eq r5 true;
    gt r1 block.height into r6;
    assert.eq r6 true;
    get autoperp_oracle_v2.aleo/prices[r2] into r7;
    gt r3 r7 into r8;
    sub r3 r7 into r9;
    sub r7 r3 into r10;
    ternary r8 r9 r10 into r11;
    div r7 100u64 into r12;
    lte r11 r12 into r13;
    assert.eq r13 true;
    set false into active_auths[r0];
    get.or_use agent_executions[r4] 0u64 into r14;
    add r14 1u64 into r15;
    set r15 into agent_executions[r4];

function revoke_auth:
    input r0 as AgentAuth.record;
    assert.eq r0.owner self.signer;
    hash.bhp256 r0.owner into r1 as field;
    async revoke_auth r1 into r2;
    output r2 as autoperp_agent_v3.aleo/revoke_auth.future;

finalize revoke_auth:
    input r0 as field.public;
    set false into active_auths[r0];

constructor:
    assert.eq edition 0u16;
