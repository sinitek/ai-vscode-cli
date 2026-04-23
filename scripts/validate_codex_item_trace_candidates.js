const assert = require('node:assert/strict');
const {
  extractCodexItemTraceCandidate,
  normalizeCodexExecItemType,
} = require('../dist/interactive/codexAppServerEvents');

function collectTraceContents(events) {
  const emitted = new Map();
  const traces = [];
  for (const event of events) {
    const candidate = extractCodexItemTraceCandidate(event.item, event.eventType);
    if (!candidate) {
      continue;
    }
    const key = candidate.itemId ? `${candidate.itemType}:${candidate.itemId}` : '';
    if (key && emitted.get(key) === candidate.content) {
      continue;
    }
    if (key) {
      emitted.set(key, candidate.content);
    }
    traces.push(candidate.content);
  }
  return traces;
}

assert.equal(
  normalizeCodexExecItemType('commandExecution'),
  'command_execution',
  'commandExecution 必须归一化为 command_execution'
);

assert.equal(
  normalizeCodexExecItemType('mcpToolCall'),
  'mcp_tool_call',
  'mcpToolCall 必须归一化为 mcp_tool_call'
);

assert.deepEqual(
  collectTraceContents([
    {
      eventType: 'item.started',
      item: {
        type: 'commandExecution',
        id: 'cmd_missing_started',
        command: '',
        status: 'inProgress',
      },
    },
    {
      eventType: 'item.completed',
      item: {
        type: 'commandExecution',
        id: 'cmd_missing_started',
        command: 'npm run build',
        status: 'completed',
      },
    },
  ]),
  ['exec npm run build'],
  'started 空 command 不能吞掉 completed 的真实命令 trace'
);

assert.deepEqual(
  collectTraceContents([
    {
      eventType: 'item.started',
      item: {
        type: 'commandExecution',
        id: 'cmd_same_content',
        command: 'npm run build',
        status: 'inProgress',
      },
    },
    {
      eventType: 'item.completed',
      item: {
        type: 'commandExecution',
        id: 'cmd_same_content',
        command: 'npm run build',
        status: 'completed',
      },
    },
  ]),
  ['exec npm run build'],
  'started/completed 内容相同的命令 trace 不能重复上屏'
);

const mcpCompletedOnly = collectTraceContents([
  {
    eventType: 'item.started',
    item: {
      type: 'mcpToolCall',
      id: 'mcp_missing_started',
      status: 'inProgress',
    },
  },
  {
    eventType: 'item.completed',
    item: {
      type: 'mcpToolCall',
      id: 'mcp_missing_started',
      server: 'openaiDeveloperDocs',
      tool: 'search_docs',
      status: 'completed',
      arguments: { query: 'codex app server' },
    },
  },
]);
assert.equal(mcpCompletedOnly.length, 1, 'started 缺少 server/tool 的 mcp trace 不能提前占位');
assert.match(mcpCompletedOnly[0], /^mcp\nopenaiDeveloperDocs :: search_docs\nparams: \{/m, 'completed mcp trace 必须保留真实工具身份和参数');

const mcpStableAndFailed = collectTraceContents([
  {
    eventType: 'item.started',
    item: {
      type: 'mcpToolCall',
      id: 'mcp_failed',
      server: 'openaiDeveloperDocs',
      tool: 'search_docs',
      status: 'inProgress',
      arguments: { query: 'codex app server' },
    },
  },
  {
    eventType: 'item.completed',
    item: {
      type: 'mcpToolCall',
      id: 'mcp_failed',
      server: 'openaiDeveloperDocs',
      tool: 'search_docs',
      status: 'failed',
      arguments: { query: 'codex app server' },
    },
  },
]);
assert.equal(mcpStableAndFailed.length, 2, 'mcp completed 失败状态变化必须保留为新的可见 trace');
assert.doesNotMatch(mcpStableAndFailed[0], /status:/i, 'started 阶段不应把易变 status 固化进基础 mcp trace');
assert.match(mcpStableAndFailed[1], /status: failed/i, 'completed 失败的 mcp trace 必须带失败状态');

assert.deepEqual(
  collectTraceContents([
    {
      eventType: 'item.started',
      item: {
        type: 'webSearch',
        id: 'ws_started_empty',
        query: '',
        action: { type: 'other' },
      },
    },
    {
      eventType: 'item.completed',
      item: {
        type: 'webSearch',
        id: 'ws_started_empty',
        query: 'weather: Shanghai, China',
        action: {
          type: 'search',
          query: 'weather: Shanghai, China',
        },
      },
    },
  ]),
  ['web search weather: Shanghai, China'],
  'web_search 仍必须兼容 started 空 query + completed 有 query'
);

console.log('codex item trace candidate validation passed');
