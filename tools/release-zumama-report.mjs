import assert from 'node:assert/strict';

export function zumamaRows(matches) {
  return ['zumama2', 'zumama4'].map((scenario, i) => {
    const games = matches.filter(g => g.scenario === scenario), seen = new Set();
    assert.ok(games.length, `Missing release scenario: ${scenario}`);
    for (const g of games) {
      assert.ok(!seen.has(g.seed), 'Duplicate seed within a scenario'); seen.add(g.seed);
      assert.equal(g.completed, true); assert.equal(g.errors, 0);
      for (const n of [g.reachedRound, g.zumama.sargonLayers, g.zumama.leaks, g.zumama.uniteKills])
        assert.ok(Number.isFinite(n) && n >= 0, 'Missing or invalid release metric');
      assert.equal(g.uniteEvidence.reduce((sum, r) => sum + r.creditedToZumama, 0), g.zumama.uniteKills);
      for (const r of g.uniteEvidence) {
        assert.ok(r.creditedToZumama >= 0 && r.creditedToZumama <= r.countedKilled);
        assert.match(r.specSha256, /^[0-9a-f]{64}$/);
        assert.match(r.resultDigestSha256, /^[0-9a-f]{64}$/);
      }
    }
    const avg = f => games.reduce((sum, g) => sum + f(g), 0) / games.length;
    return { scenario, label: i ? '四人：祖玛玛＋3bot' : '二人：祖玛玛＋bot',
      wins: games.filter(g => g.victory).length, total: games.length,
      reachedRound: avg(g => g.reachedRound), sargonLayers: avg(g => g.zumama.sargonLayers),
      leaks: avg(g => g.zumama.leaks), uniteKills: avg(g => g.zumama.uniteKills) };
  });
}

export function zumamaTable(rows) {
  assert.deepEqual(rows.map(r => r.scenario), ['zumama2', 'zumama4']);
  return ['| 多人模式（终极） | 胜场/总场数 | 平均到达回合 | 祖玛玛萨尔贡平均层数 | 祖玛玛平均漏怪 | 祖玛玛平均兜怪 |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r.label} | ${r.wins}/${r.total} | ${r.reachedRound.toFixed(2)} | ${r.sargonLayers.toFixed(2)} | ${r.leaks.toFixed(2)} | ${r.uniteKills.toFixed(2)} |`)].join('\n');
}
