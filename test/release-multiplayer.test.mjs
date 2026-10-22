import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { multiplayerRows, multiplayerTable } from '../tools/release-multiplayer-report.mjs';

const game = (scenario, seed, reachedRound, lateranoLayers, leaks, uniteKills, victory = false) =>
  ({ scenario, seed, reachedRound, completed: true, errors: 0, victory, arturia: { lateranoLayers, leaks, uniteKills } });

test('release metrics use every game and Arturia only, keeping team arrival and player counts separate', () => {
  const rows = multiplayerRows([
    game('arturia2', 1, 15, 200, 8, 30, true),
    game('arturia2', 2, 7, 0, 2, 0), // early elimination remains in every mean
    game('arturia4', 1, 13, 30, 4, 12),
    game('legacy2', 1, 100, 9999, 9999, 9999),
  ]);
  assert.deepEqual(rows.map(({ label, ...r }) => r), [
    { scenario: 'arturia2', wins: 1, total: 2, reachedRound: 11, lateranoLayers: 100, leaks: 5, uniteKills: 15 },
    { scenario: 'arturia4', wins: 0, total: 1, reachedRound: 13, lateranoLayers: 30, leaks: 4, uniteKills: 12 },
  ]);
  assert.equal(multiplayerTable(rows).split('\n').length, 4, 'header, separator, two mode rows');
  assert.throws(() => multiplayerRows([game('arturia2', 1, 1, 0, 0, 0)]), /Missing/);
  assert.throws(() => multiplayerRows([game('arturia2', 1, 1, 0, 0, 0), game('arturia2', 1, 1, 0, 0, 0)]), /Duplicate/);
});

test('published multiplayer rows reproduce the complete named-teammate samples and public table', () => {
  const report = JSON.parse(readFileSync(new URL('../benchmarks/arturia-v0.2.3-multiplayer.json', import.meta.url)));
  assert.equal(report.matches.length, 112);
  assert.deepEqual(multiplayerRows(report.matches), report.rows);
  assert.deepEqual(report.rows.map(r => [r.scenario, r.wins, r.total]), [['arturia2', 16, 56], ['arturia4', 13, 56]]);
  const table = multiplayerTable(report.rows);
  for (const path of ['README.md', 'docs/strategies/laterano.md', 'addons/arturia/README.md', 'benchmarks/arturia-v0.2.3-multiplayer.md'])
    assert.ok(readFileSync(new URL('../' + path, import.meta.url), 'utf8').includes(table), path);
});
