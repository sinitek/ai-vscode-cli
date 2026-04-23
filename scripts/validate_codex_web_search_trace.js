const assert = require('node:assert/strict');
const {
  extractCodexWebSearchTraceCandidate,
  normalizeCodexExecItemType,
} = require('../dist/interactive/codexAppServerEvents');

assert.equal(
  normalizeCodexExecItemType('webSearch'),
  'web_search',
  'webSearch 必须归一化为 web_search'
);

assert.equal(
  extractCodexWebSearchTraceCandidate(
    {
      type: 'webSearch',
      id: 'ws_started_empty',
      query: '',
      action: { type: 'other' },
    },
    'item.started'
  ),
  null,
  'started 阶段的空 query web_search 不能提前产出 trace'
);

assert.deepEqual(
  extractCodexWebSearchTraceCandidate(
    {
      type: 'webSearch',
      id: 'ws_completed_query',
      query: 'weather: Shanghai, China',
      action: {
        type: 'search',
        query: 'weather: Shanghai, China',
      },
    },
    'item.completed'
  ),
  {
    itemId: 'ws_completed_query',
    query: 'weather: Shanghai, China',
  },
  'completed 阶段的真实 query 必须能产出 trace'
);

assert.deepEqual(
  extractCodexWebSearchTraceCandidate(
    {
      type: 'webSearch',
      id: 'ws_action_query',
      query: '',
      action: {
        type: 'search',
        query: 'Shanghai weather today AccuWeather',
      },
    },
    'item.completed'
  ),
  {
    itemId: 'ws_action_query',
    query: 'Shanghai weather today AccuWeather',
  },
  'query 为空时必须能回退读取 action.query'
);

assert.deepEqual(
  extractCodexWebSearchTraceCandidate(
    {
      type: 'webSearch',
      id: 'ws_open_page',
      query: '',
      action: {
        type: 'open_page',
        url: 'https://weather.com/weather/today/l/Shanghai',
      },
    },
    'item.completed'
  ),
  {
    itemId: 'ws_open_page',
    query: 'https://weather.com/weather/today/l/Shanghai',
  },
  'open_page 场景必须能回退读取 action.url'
);

console.log('codex web search trace validation passed');
