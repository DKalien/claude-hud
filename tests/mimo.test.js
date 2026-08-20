import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeConfig } from '../dist/config.js';
import { getMimoSnapshot } from '../dist/mimo-snapshot.js';
import { renderMimoLine } from '../dist/render/lines/mimo.js';

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

test('MIMO snapshot parsing feeds the usage renderer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'claude-hud-mimo-'));
  const snapshotPath = path.join(dir, 'mimo.json');
  const updatedAt = 1_700_000_000;
  const now = updatedAt * 1000 + 1000;

  try {
    await writeFile(snapshotPath, JSON.stringify({
      updated_at: updatedAt,
      plan_name: 'Pro',
      used_percentage: 42.4,
      balance: 12.345,
      balance_currency: '¥',
    }), 'utf8');

    const config = mergeConfig({
      display: {
        showMimoUsage: true,
        mimoSnapshotPath: snapshotPath,
        mimoFreshnessMs: 400_000,
      },
    });
    const snapshot = getMimoSnapshot(config, now);

    assert.equal(snapshot?.plan_name, 'Pro');
    assert.equal(snapshot?.used_percentage, 42);
    assert.equal(snapshot?.balance, 12.35);

    const line = stripAnsi(renderMimoLine({ config, mimoSnapshot: snapshot }) ?? '');
    assert.match(line, /^MIMO \[Pro\]/);
    assert.match(line, /42%/);
    assert.match(line, /余额: ¥12\.35/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
