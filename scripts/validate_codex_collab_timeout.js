const assert = require('node:assert/strict');
const {
  extractCodexCollabToolFailure,
  extractCodexRawResponseToolCall,
  extractCodexWaitTimeoutPayload,
  normalizeCodexExecItemType,
} = require('../dist/interactive/codexAppServerEvents');

assert.equal(
  normalizeCodexExecItemType('collabAgentToolCall'),
  'collab_agent_tool_call',
  'collabAgentToolCall 必须归一化为 collab_agent_tool_call'
);

assert.deepEqual(
  extractCodexRawResponseToolCall({
    type: 'function_call',
    name: 'wait',
    call_id: 'call_wait_1',
  }),
  {
    callId: 'call_wait_1',
    toolName: 'wait',
  },
  '必须能从 raw response tool call 中提取 wait 工具名'
);

const waitTimeout = extractCodexWaitTimeoutPayload(
  {
    type: 'function_call_output',
    call_id: 'call_wait_1',
    output: {
      body: '{"status":{},"timed_out":true}',
      success: true,
    },
  },
  'wait'
);
assert.ok(waitTimeout, 'wait 超时输出必须被识别');
assert.equal(waitTimeout.toolName, 'wait', 'wait 超时输出必须保留工具名');
assert.match(waitTimeout.detail, /timed_out/i, 'wait 超时详情必须包含 timed_out');

const collabFailure = extractCodexCollabToolFailure({
  type: 'collabAgentToolCall',
  tool: 'wait',
  status: 'failed',
  agentsStates: {
    'agent-1': {
      status: {
        errored: 'wait timed out',
      },
      message: null,
    },
  },
});
assert.ok(collabFailure, 'collab wait 失败必须被识别');
assert.equal(collabFailure.tool, 'wait', 'collab 失败必须保留工具名');
assert.match(collabFailure.detail, /wait timed out/i, 'collab 失败详情必须包含子任务错误');

console.log('codex collab timeout validation passed');
