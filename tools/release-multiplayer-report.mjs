import assert from 'node:assert/strict';

// Release tables contain named-teammate games only. Each original game contributes once,
// including games in which Arturia was eliminated before the team finished.
export function multiplayerRows(matches) {
  return ['arturia2', 'arturia4'].map(scenario => {
    const games = matches.filter(g => g.scenario === scenario);
    assert.ok(games.length, `Missing release scenario: ${scenario}`);
    const seen = new Set();
    for (const g of games) {
      assert.ok(!seen.has(g.seed), 'Duplicate seed within a scenario'); seen.add(g.seed);
      assert.equal(g.completed, true); assert.equal(g.errors, 0);
      for (const value of [g.reachedRound, g.arturia.lateranoLayers, g.arturia.leaks, g.arturia.uniteKills])
        assert.ok(Number.isFinite(value) && value >= 0, 'Missing or invalid release metric');
    }
    const avg = f => games.reduce((sum, g) => sum + f(g), 0) / games.length;
    return { scenario, label: scenario === 'arturia2' ? '二人：图图＋bot' : '四人：图图＋3bot',
      wins: games.filter(g => g.victory).length, total: games.length,
      reachedRound: avg(g => g.reachedRound), lateranoLayers: avg(g => g.arturia.lateranoLayers),
      leaks: avg(g => g.arturia.leaks), uniteKills: avg(g => g.arturia.uniteKills) };
  });
}

export function multiplayerTable(rows) {
  assert.deepEqual(rows.map(r => r.scenario), ['arturia2', 'arturia4']);
  return ['| 多人模式（终极） | 胜场/总场数 | 平均到达回合 | 图图拉特兰平均层数 | 图图平均漏怪 | 图图平均兜怪 |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.label} | ${r.wins}/${r.total} | ${r.reachedRound.toFixed(2)} | ${r.lateranoLayers.toFixed(2)} | ${r.leaks.toFixed(2)} | ${r.uniteKills.toFixed(2)} |`)].join('\n');
}
