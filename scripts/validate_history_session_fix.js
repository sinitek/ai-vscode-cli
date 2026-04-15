const assert = require('node:assert/strict');
const {
  findSupersedingSessionId,
  isLocalSessionId,
  mergeSessionMessages,
  mergeSessionRecords,
} = require('../dist/interactive/sessionHistoryRepair');

const localSession = {
  id: 'local_1776045249701_18624b8f869558',
  label: '@media/official-',
  createdAt: 1776045249701,
  lastUsedAt: 1776220117395,
  firstPrompt: '@media/official-skills  这里可以从官方更新和补充了，确保 CLI 配置页面 skills 能更新到',
};

const realSession = {
  id: '019d848b-d5d9-7453-8c0c-46261a4dc801',
  label: '@media/official-',
  createdAt: 1776045250018,
  lastUsedAt: 1776127752333,
  firstPrompt: '@media/official-skills  这里可以从官方更新和补充了，确保 CLI 配置页面 skills 能更新到',
};

const localMessages = [
  {
    id: 'msg_user_original',
    role: 'user',
    content: localSession.firstPrompt,
    createdAt: 1776045249466,
    sequence: 0,
  },
  {
    id: 'msg_user_retry',
    role: 'user',
    content: 'hi',
    createdAt: 1776219883184,
    sequence: 1,
  },
  {
    id: 'msg_system_error',
    role: 'system',
    content: 'invalid thread id: local_*',
    createdAt: 1776219883637,
    sequence: 2,
  },
];

const realMessages = [
  {
    id: 'msg_user_original',
    role: 'user',
    content: localSession.firstPrompt,
    createdAt: 1776045249466,
    sequence: 0,
  },
  {
    id: 'msg_assistant_answer',
    role: 'assistant',
    content: 'assistant response',
    createdAt: 1776045260562,
    sequence: 1,
  },
];

const messagesBySessionId = {
  [localSession.id]: localMessages,
  [realSession.id]: realMessages,
};

assert.equal(isLocalSessionId(localSession.id), true, 'local_* 必须被识别为临时会话');
assert.equal(isLocalSessionId(realSession.id), false, '真实 UUID 会话不能被识别为 local 临时会话');

const supersedingId = findSupersedingSessionId(localSession, [localSession, realSession], {
  getMessages: (sessionId) => messagesBySessionId[sessionId] || [],
});
assert.equal(
  supersedingId,
  realSession.id,
  '历史恢复时应优先命中真实 threadId 对应的会话，避免继续使用 local_*'
);

const mergedMessages = mergeSessionMessages(realMessages, localMessages);
assert.deepEqual(
  mergedMessages.map((message) => message.id),
  ['msg_user_original', 'msg_assistant_answer', 'msg_user_retry', 'msg_system_error'],
  '迁移/合并后必须保留完整消息并去重'
);
assert.deepEqual(
  mergedMessages.map((message) => message.sequence),
  [0, 1, 2, 3],
  '迁移/合并后消息序号必须连续'
);

const mergedRecord = mergeSessionRecords(realSession, localSession);
assert.equal(mergedRecord.id, realSession.id, '合并后应保留真实会话 ID');
assert.equal(mergedRecord.createdAt, localSession.createdAt, '合并后应保留更早的创建时间');
assert.equal(mergedRecord.lastUsedAt, localSession.lastUsedAt, '合并后应保留最新使用时间');

console.log('history session repair validation passed');
