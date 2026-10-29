// Candidate-generation experiment only. No match seed or teammate formation is read.
export function observeEffectiveHealing(battle, ownerId) {
  const received = {}, heal = battle.heal.bind(battle);
  battle.heal = (source, target, ...args) => {
    const actual = heal(source, target, ...args);
    if (actual > 0 && source?.ownerId === ownerId && target?.ownerId === ownerId) {
      const row = received[target.uid] ||= {};
      row[source.uid] = (row[source.uid] || 0) + actual;
    }
    return actual;
  };
  return received;
}

export function protectedHealingPlans(m, ps, h, original, paired, geometry) {
  const {DIRS, healingTiles, acceptsHealing, finalContact, demand} = geometry;
  const targets = demand.targets, lineup = original.lineup;
  const pos = key => key.split(',').map(Number);
  const distance = (a, b) => {const [r,c] = pos(a), [s,d] = pos(b); return Math.abs(r-s)+Math.abs(c-d);};
  const recs = new Map(lineup.map(p => [p.uid, h.rangeRec(ps, ps.gd.chess(p.id))]));
  const isMedic = rec => rec.attackKind === 'heal' || rec.dmgType === 'heal' || rec.subProfessionId === 'incantationmedic';
  const medics = lineup.filter(p => isMedic(recs.get(p.uid)));
  const cover = (p, plan) => {const [r,c] = pos(plan.get(p.uid)); return healingTiles(recs.get(p.uid), r, c, plan.dirs.get(p.uid));};
  const healed = (uid, plan) => medics.some(p => cover(p, plan).has(plan.get(uid)));
  // Low residual injury can be evidence that the existing healing works, not that it is dispensable.
  const protectedTargets = lineup.filter(p => acceptsHealing(recs.get(p.uid)) && healed(p.uid, original)).map(p => {
    const taken = paired.reduce((n,r) => n+(r.unitStats.find(s => s.uid === p.uid)?.taken || 0), 0)/paired.length;
    const effectiveHealing = paired.reduce((n,r) => n+medics.reduce((a,q) =>
      a+(cover(q,original).has(original.get(p.uid)) ? r.healingReceived?.[p.uid]?.[q.uid] || 0 : 0), 0), 0)/paired.length;
    return {uid:p.uid, id:p.id, taken, effectiveHealing, reason:effectiveHealing > 0 ? 'effective-healing' : 'covered-and-damaged'};
  }).filter(p => p.taken > 0 || p.effectiveHealing > 0);
  const protectedOK = plan => protectedTargets.every(t => healed(t.uid, plan));
  const score = plan => targets.reduce((n,t) => n+(healed(t.uid, plan) ? t.weight : 0), 0);
  const before = score(original), model = h.fieldModel(m, ps);
  const clone = plan => {const p = new h.LayoutPlan(plan); p.dirs = new Map(plan.dirs);
    p.reserved = new Set(plan.reserved); p.lineup = lineup; return p;};
  const reserved = new Set([...original.reserved, ...[...ps.board].filter(([,p]) => p.kind !== 'chess').map(([key]) => key)]);
  const fixed = new Set([...ps.board.values()].filter(p => p.kind === 'token').map(p => p.ownerUid));
  const tiles = [...ps.deployMap().keys()].filter(k => !reserved.has(k));
  const contact = (p,key,dir) => {const [r,c] = pos(key), rec = recs.get(p.uid);
    return finalContact(model, rec, new Set(h.rangeTiles(rec,r,c,dir)));};
  const oldContact = new Map(lineup.map(p => [p.uid, contact(p,original.get(p.uid),original.dirs.get(p.uid))]));
  const contactOK = (p,key,dir) => isMedic(recs.get(p.uid)) && recs.get(p.uid).subProfessionId !== 'incantationmedic'
    || contact(p,key,dir)+1e-6 >= Math.max(.01,oldContact.get(p.uid)*.9);
  const moves = plan => lineup.filter(p => original.get(p.uid) !== plan.get(p.uid) || original.dirs.get(p.uid) !== plan.dirs.get(p.uid))
    .map(p => ({uid:p.uid,id:p.id,from:original.get(p.uid),fromDir:original.dirs.get(p.uid),to:plan.get(p.uid),dir:plan.dirs.get(p.uid),
      distance:distance(original.get(p.uid),plan.get(p.uid)),beforeContact:oldContact.get(p.uid),contact:contact(p,plan.get(p.uid),plan.dirs.get(p.uid))}));
  const allyMoves = plan => moves(plan).filter(r => !medics.some(p => p.uid === r.uid));
  const footprint = plan => [...plan].map(([uid,k]) => `${uid}@${k}:${plan.dirs.get(uid)}`).sort().join('|');
  // A small beam repairs lost protected recipients before any candidate is eligible for forecasting.
  function relocate(p, start) {
    if (fixed.has(p.uid) || isMedic(recs.get(p.uid))) return [];
    const occupied = new Set([...start].filter(([uid]) => uid !== p.uid).map(([,k]) => k)), out = [];
    for (const key of tiles) {
      if (occupied.has(key) || distance(original.get(p.uid),key) > 2) continue;
      const [r,c] = pos(key); if (!ps._legal(p,r,c)) continue;
      const plan = clone(start); plan.set(p.uid,key); if (!healed(p.uid,plan)) continue;
      const dirs = DIRS.filter(dir => contactOK(p,key,dir));
      dirs.sort((a,b) => contact(p,key,b)-contact(p,key,a)
        || Number(b === original.dirs.get(p.uid))-Number(a === original.dirs.get(p.uid)) || a.localeCompare(b));
      if (!dirs.length) continue;
      plan.dirs.set(p.uid,dirs[0]); if (allyMoves(plan).length > 3) continue;
      out.push(plan);
    }
    out.sort((a,b) => contact(p,b.get(p.uid),b.dirs.get(p.uid))-contact(p,a.get(p.uid),a.dirs.get(p.uid))
      || distance(original.get(p.uid),a.get(p.uid))-distance(original.get(p.uid),b.get(p.uid))
      || a.get(p.uid).localeCompare(b.get(p.uid)));
    return out.slice(0,4);
  }
  const rows = [];
  function add(plan, medic) {
    const after = score(plan); if (!protectedOK(plan) || after <= before+1e-6) return;
    const moved = moves(plan), covered = targets.filter(t => healed(t.uid,plan)).map(t => t.uid);
    rows.push({plan,uid:medic.uid,from:original.get(medic.uid),to:plan.get(medic.uid),dir:plan.dirs.get(medic.uid),
      before,after,gain:after-before,covered,protected:protectedTargets.map(t => t.uid),moves:moved,
      mode:allyMoves(plan).length ? 'linked-allies' : 'medic-only',distance:moved.reduce((n,r) => n+r.distance,0)});
  }
  for (const medic of medics.filter(p => recs.get(p.uid).position === 'RANGED' && !fixed.has(p.uid))) {
    const occupied = new Set([...original].filter(([uid]) => uid !== medic.uid).map(([,k]) => k));
    for (const key of tiles) {
      const [r,c] = pos(key); if (occupied.has(key) || !ps._legal(medic,r,c)) continue;
      for (const dir of DIRS) {
        if (!contactOK(medic,key,dir)) continue;
        const plan = clone(original); plan.set(medic.uid,key); plan.dirs.set(medic.uid,dir);
        const lost = protectedTargets.filter(t => !healed(t.uid,plan)); if (lost.length > 3) continue;
        let beam = [plan];
        for (const t of lost) {
          const p = lineup.find(p => p.uid === t.uid);
          beam = beam.flatMap(candidate => healed(t.uid,candidate) ? [candidate] : relocate(p,candidate));
          beam.sort((a,b) => score(b)-score(a) || moves(a).length-moves(b).length || footprint(a).localeCompare(footprint(b)));
          beam = beam.slice(0,4); if (!beam.length) break;
        }
        for (const candidate of beam) {
          add(candidate,medic);
          let expanded = candidate;
          // Also pull at most two uncovered injured allies into range, without vacating protection or contact.
          for (let step = 0; step < 2; step++) {
            const options = targets.filter(t => !healed(t.uid,expanded)).flatMap(t =>
              relocate(lineup.find(p => p.uid === t.uid),expanded)).filter(protectedOK);
            options.sort((a,b) => score(b)-score(a) || moves(a).length-moves(b).length || footprint(a).localeCompare(footprint(b)));
            if (!options.length || score(options[0]) <= score(expanded)+1e-6) break;
            expanded = options[0]; add(expanded,medic);
          }
        }
      }
    }
  }
  rows.sort((a,b) => b.gain-a.gain || a.moves.length-b.moves.length || a.distance-b.distance
    || a.uid-b.uid || footprint(a.plan).localeCompare(footprint(b.plan)));
  // There is room for two full alternatives after the ten-sample reference. Prefer distinct coverage portfolios.
  const unique = [], seen = new Set();
  for (const row of rows) if (!seen.has(footprint(row.plan))) {seen.add(footprint(row.plan)); unique.push(row);}
  const selected = unique.slice(0,1), first = selected[0];
  if (first) {
    const other = unique.find(r => r.mode !== first.mode || r.covered.join(',') !== first.covered.join(',')) || unique[1];
    if (other) selected.push(other);
  }
  return {...demand,protectedTargets,plans:selected.map(r => r.plan),proposals:selected.map(({plan,...r}) => r),
    weak:medics.map(p => ({uid:p.uid,id:p.id,before,best:rows[0]?.after ?? before})),generated:unique.length};
}
