import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeConfig } from '../dist/config.js';
import { getMimoSnapshot } from '../dist/mimo-snapshot.js';
import { renderMimoLine } from '../dist/render/mimo.js';
import { renderLines } from '../dist/render/index.js';

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

test('MIMO settings default off and validate the snapshot path and freshness', () => {
  const defaults = mergeConfig({});
  assert.equal(defaults.display.showMimoUsage, false);
  assert.equal(defaults.display.mimoSnapshotPath, '');
  assert.equal(defaults.display.mimoFreshnessMs, 400_000);

  const configured = mergeConfig({
    display: { showMimoUsage: true, mimoSnapshotPath: '~/mimo.json', mimoFreshnessMs: -1 },
  });
  assert.equal(configured.display.showMimoUsage, true);
  assert.equal(configured.display.mimoSnapshotPath, path.join(os.homedir(), 'mimo.json'));
  assert.equal(configured.display.mimoFreshnessMs, 0);
});

test('MIMO snapshot parsing feeds its orderable expanded renderer', async () => {
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
      elementOrder: ['mimo'],
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

    const line = stripAnsi(renderMimoLine({ config, mimoSnapshot: snapshot, barWidth: 10 }) ?? '');
    assert.match(line, /^MIMO \[Pro\]/);
    assert.match(line, /42%/);
    assert.match(line, /余额: ¥12\.35/);

    const lines = renderLines({
      stdin: {},
      transcript: { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] },
      claudeMdCount: 0,
      rulesCount: 0,
      mcpCount: 0,
      hooksCount: 0,
      costTotals: null,
      outputSpeed: null,
      gitStatus: null,
      usageData: null,
      memoryUsage: null,
      mimoSnapshot: snapshot,
      config,
      extraLabel: null,
    }, 80, now).map(stripAnsi);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^MIMO \[Pro\]/);

    const placed = mergeConfig({ elementOrder: ['project', 'cost', 'mimo'], display: { showCost: true, showMimoUsage: true } });
    const combined = renderLines({
      stdin: { cost: { total_cost_usd: 1.23 } },
      transcript: { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] },
      claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0,
      costTotals: null, outputSpeed: null, gitStatus: null, usageData: null, memoryUsage: null,
      mimoSnapshot: snapshot, config: placed, extraLabel: null,
    }, 80, now).map(stripAnsi).join('\n');
    assert.equal((combined.match(/Cost \$1\.23/g) ?? []).length, 1);
    assert.match(combined, /MIMO \[Pro\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
