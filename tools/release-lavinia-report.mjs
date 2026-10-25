import assert from 'node:assert/strict';

// Same all-game, named-player metrics as Arturia; Siracusa effective layers are reported here.
export function laviniaRows(matches) {
  return ['siracusa2', 'siracusa4'].map((scenario, i) => {
    const games = matches.filter(g => g.scenario === scenario), seen = new Set();
    assert.ok(games.length, `Missing release scenario: ${scenario}`);
    for (const g of games) {
      assert.ok(!seen.has(g.seed), 'Duplicate seed within a scenario'); seen.add(g.seed);
      assert.equal(g.completed, true); assert.equal(g.errors, 0);
      for (const n of [g.reachedRound, g.lavinia.siracusaLayers, g.lavinia.leaks, g.lavinia.uniteKills])
        assert.ok(Number.isFinite(n) && n >= 0, 'Missing or invalid release metric');
    }
    const avg = f => games.reduce((sum, g) => sum + f(g), 0) / games.length;
    return { scenario, label: i ? '四人：拉维妮娅＋3bot' : '二人：拉维妮娅＋bot',
      wins: games.filter(g => g.victory).length, total: games.length,
      reachedRound: avg(g => g.reachedRound), siracusaLayers: avg(g => g.lavinia.siracusaLayers),
      leaks: avg(g => g.lavinia.leaks), uniteKills: avg(g => g.lavinia.uniteKills) };
  });
}

export function laviniaTable(rows) {
  assert.deepEqual(rows.map(r => r.scenario), ['siracusa2', 'siracusa4']);
  return ['| 多人模式（终极） | 胜场/总场数 | 平均到达回合 | 拉维妮娅叙拉古平均层数 | 拉维妮娅平均漏怪 | 拉维妮娅平均兜怪 |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.label} | ${r.wins}/${r.total} | ${r.reachedRound.toFixed(2)} | ${r.siracusaLayers.toFixed(2)} | ${r.leaks.toFixed(2)} | ${r.uniteKills.toFixed(2)} |`)].join('\n');
}
