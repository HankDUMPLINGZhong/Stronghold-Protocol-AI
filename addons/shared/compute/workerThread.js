// Node-only driver; the deterministic battle engine itself has no thread or clock dependencies.
import { workerData } from 'node:worker_threads';
import Battle from '../../sim/Battle.js';
import { DataSource, setSimData } from '../../sim/simdata.js';
import { SharedBossPool } from '../finalAssault.js';

const { port, gate: sharedGate, data: raw } = workerData;
const gate = new Int32Array(sharedGate), data = new DataSource(raw, null);
setSimData(raw);
const log = { info() {}, debug() {}, warn() {}, error() {} };
const post = message => { port.postMessage(message); Atomics.add(gate, 0, 1); Atomics.notify(gate, 0); };
port.on('message', ({ id, spec, hp, playerId, cap, deadline, projection = 'boss-damage', cancel: sharedCancel }) => {
  const cancel = new Int32Array(sharedCancel); let battle;
  const stopped = () => Atomics.load(cancel, 0) !== 0 || deadline != null && performance.timeOrigin + performance.now() >= deadline;
  try {
    if (stopped()) { post({ id, canceled: true }); return; }
    const pool = hp == null ? null : new SharedBossPool(hp);
    battle = new Battle({ ...spec, data, sharedBoss: pool, content: 'full', logger: log });
    let ticks = 0;
    while (!battle.finished && ticks < cap) {
      battle.step(); ticks++;
      if (ticks % 16 === 0 && stopped()) { post({ id, canceled: true, ticks }); return; }
    }
    if (!battle.finished) battle.forceEnd('timeout');
    const result = battle.result();
    const valid = !battle.errorCount && !result.synthetic && !result.errors;
    // Only metrics are projected here. Candidate selection and scoring remain in the caller.
    const row = projection === 'battle-result'
      ? { valid, result, elapsed: battle.time, bossHp: pool?.hp, bossDamage: pool?.byPlayer.get(playerId) || 0 }
      : { valid, bossDamage: pool?.byPlayer.get(playerId) || 0, elapsed: battle.time };
    post({ id, ticks, row });
  } catch (error) { post({ id, error: String(error.message || error) }); }
  finally { battle?.dispose?.(); }
});
post({ ready: true });
