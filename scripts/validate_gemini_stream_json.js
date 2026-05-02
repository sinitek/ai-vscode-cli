const assert = require('assert');
const {
  ensureGeminiHeadlessArgs,
  parseGeminiStreamJsonChunk,
  finalizeGeminiStreamJsonRemainder,
  getGeminiEventDisplay,
} = require('../dist/cli/geminiStreamJson');

const args = ensureGeminiHeadlessArgs(['--approval-mode', 'auto_edit'], 'Say OK');
assert.deepStrictEqual(args, ['--approval-mode', 'auto_edit', '-p', 'Say OK', '--output-format', 'stream-json']);

const argsWithPrompt = ensureGeminiHeadlessArgs(['--approval-mode', 'auto_edit', '--prompt', 'custom'], 'ignored');
assert.deepStrictEqual(argsWithPrompt, ['--approval-mode', 'auto_edit', '--prompt', 'custom', '--output-format', 'stream-json']);

const argsWithFormat = ensureGeminiHeadlessArgs(['--approval-mode', 'auto_edit', '--output-format', 'json'], 'Say OK');
assert.deepStrictEqual(argsWithFormat, ['--approval-mode', 'auto_edit', '--output-format', 'json', '-p', 'Say OK']);

const chunk = [
  JSON.stringify({ type: 'init', session_id: 'abc-123' }),
  JSON.stringify({ type: 'message', role: 'assistant', content: 'OK', delta: true }),
  JSON.stringify({ type: 'result', status: 'success' }),
  '',
].join('\n');
const parsed = parseGeminiStreamJsonChunk('', chunk);
assert.strictEqual(parsed.events.length, 3);
assert.strictEqual(parsed.remainder, '');
assert.strictEqual(getGeminiEventDisplay(parsed.events[0]).sessionId, 'abc-123');
assert.strictEqual(getGeminiEventDisplay(parsed.events[1]).assistantText, 'OK');
assert.strictEqual(getGeminiEventDisplay(parsed.events[2]).resultStatus, 'success');

const partial = parseGeminiStreamJsonChunk('', '{"type":"message","role":"assistant","content":"Hi"');
assert.strictEqual(partial.events.length, 0);
const finalized = finalizeGeminiStreamJsonRemainder(partial.remainder + '}');
assert.strictEqual(finalized.kind, 'event');
assert.strictEqual(getGeminiEventDisplay(finalized.event).assistantText, 'Hi');

console.log('validate_gemini_stream_json ok');
