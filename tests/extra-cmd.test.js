import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraCmdArg, runExtraCmd, isExtraCmdAllowed } from '../dist/extra-cmd.js';

const ALLOWED = { CLAUDE_HUD_ALLOW_EXTRA_CMD: '1' };
const argv = (...args) => ['node', 'index.js', ...args];
const nodeCommand = (source) => {
  const encoded = Buffer.from(source).toString('base64');
  return `"${process.execPath}" -e "eval(Buffer.from('${encoded}', 'base64').toString())"`;
};
const printCommand = (value) => nodeCommand(`process.stdout.write(${JSON.stringify(value)})`);

test('--extra-cmd needs an explicit opt-in', () => {
  for (const value of ['1', 'true', 'YES', ' on ']) {
    assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: value }), true, value);
  }
  for (const value of [undefined, '', '0', 'false', 'enabled']) {
    assert.equal(isExtraCmdAllowed({ CLAUDE_HUD_ALLOW_EXTRA_CMD: value }), false, String(value));
  }
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', 'echo hi'), {}), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=echo hi'), {}), null);
});

test('parseExtraCmdArg reads both argument forms', () => {
  assert.equal(parseExtraCmdArg(argv(), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', 'echo "hello world"'), ALLOWED), 'echo "hello world"');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=echo a=b'), ALLOWED), 'echo a=b');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd=first', '--extra-cmd', 'second'), ALLOWED), 'first');
  assert.equal(parseExtraCmdArg(argv('--extra-cmd'), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd', ''), ALLOWED), null);
  assert.equal(parseExtraCmdArg(argv('--extra-cmd='), ALLOWED), null);
});

test('runExtraCmd takes a JSON label or the last line of plain output', async () => {
  assert.equal(await runExtraCmd(printCommand('  { "label": "test" }  ')), 'test');
  assert.equal(await runExtraCmd(printCommand('setup\nnot json\n')), 'not json');
  for (const output of ['{"other": "field"}', '{"label": 123}', '[1,2,3]', 'null', '']) {
    assert.equal(await runExtraCmd(printCommand(output)), null, output);
  }
});

test('runExtraCmd sanitizes and truncates the label', async () => {
  assert.equal(await runExtraCmd(printCommand('plain\x1b[31mred\x1b[0m\n')), 'plainred');
  assert.equal(
    await runExtraCmd(nodeCommand(`process.stdout.write(JSON.stringify({ label: '\\x1b]8;;https://x\\x07Red\\x1b]8;;\\x07' }))`)),
    'Red',
  );
  const long = await runExtraCmd(nodeCommand(`process.stdout.write(JSON.stringify({ label: '${'a'.repeat(60)}' }))`));
  assert.equal(long?.length, 50);
  assert.ok(long?.endsWith('…'));
});

test('runExtraCmd returns null on failure or timeout', async () => {
  assert.equal(await runExtraCmd(nodeCommand('process.exit(1)'), 1000), null);
  assert.equal(await runExtraCmd('nonexistent-command-xyz123'), null);

  const delayedLabel = nodeCommand(`setTimeout(() => process.stdout.write(JSON.stringify({ label: 'completed' })), 100)`);
  assert.equal(await runExtraCmd(delayedLabel, 1000), 'completed');

  const timeoutMs = 200;
  const timedOutLabel = nodeCommand(`setTimeout(() => process.stdout.write(JSON.stringify({ label: 'completed' })), 10_000)`);
  const start = Date.now();
  assert.equal(await runExtraCmd(timedOutLabel, timeoutMs), null);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= timeoutMs * 0.75, `returned before the timeout deadline (${elapsed}ms)`);
  assert.ok(elapsed < 1000, 'gave up at the timeout');
});
