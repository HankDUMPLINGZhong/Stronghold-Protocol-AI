// Process-wide two-thread pool for opt-in own-side forecasts. No engine or live match object crosses threads.
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';

let singleton;
export class ForecastWorkerPool {
  constructor(data, { size = 2, timeoutMs = 5000 } = {}) {
    this.data = data; this.timeoutMs = timeoutMs; this.closed = false; this.next = 0;
    this.gate = new Int32Array(new SharedArrayBuffer(4)); this.slots = []; this.queue = [];
    this.lastOwner = null; this.maxQueued = 32;
    for (let i = 0; i < size; i++) {
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(new URL('./workerThread.js', import.meta.url), {
        workerData: { data, gate: this.gate.buffer, port: port2 }, transferList: [port2] });
      const slot = { worker, port: port1, ready: false, active: null }; this.slots.push(slot);
      worker.on('error', () => this.fail()); worker.on('exit', code => { if (code && !this.closed) this.fail(); });
      worker.unref(); port1.unref();
    }
  }
  drain() {
    if (this.closed) return;
    for (const slot of this.slots) {
      for (let packet; (packet = receiveMessageOnPort(slot.port));) {
        const message = packet.message;
        if (message.ready) { slot.ready = true; continue; }
        const task = slot.active;
        if (!task || task.id !== message.id) continue;
        slot.active = null;
        if (!task.done) { task.value = message; task.done = true; }
      }
    }
    this.pump();
  }
  pump() {
    if (this.closed) return;
    this.queue = this.queue.filter(t => !t.done);
    for (const slot of this.slots) if (slot.ready && !slot.active && this.queue.length) {
      // Alternate owners whenever another room/player is queued; preserve FIFO within each owner.
      let index = this.queue.findIndex(t => t.owner !== this.lastOwner); if (index < 0) index = 0;
      const task = this.queue.splice(index, 1)[0]; this.lastOwner = task.owner; slot.active = task;
      try { slot.port.postMessage({ id: task.id, ...task.request, cancel: task.cancel.buffer }); }
      catch { slot.active = null; task.done = true; task.value = { error: 'unserializable-forecast' }; }
    }
  }
  submit(owner, request) {
    this.drain();
    if (this.closed || this.queue.length >= this.maxQueued) return null;
    const task = { id: this.next++, owner, request, cancel: new Int32Array(new SharedArrayBuffer(4)),
      submitted: performance.now(), done: false, value: null };
    this.queue.push(task); this.pump();
    return {
      poll: blocking => {
        do {
          this.drain();
          if (task.done) return task.value;
          if (performance.now() - task.submitted >= this.timeoutMs) { this.fail(); return task.value; }
          if (!blocking) return null;
          // Only virtual/offline runners block; real rooms yield normally and keep serving input.
          const stamp = Atomics.load(this.gate, 0);
          Atomics.wait(this.gate, 0, stamp, 10);
        } while (!task.done);
        return task.value;
      },
      cancel: () => { Atomics.store(task.cancel, 0, 1); task.done = true; task.value = { canceled: true }; },
    };
  }
  cancelOwner(owner) {
    for (const task of [...this.queue, ...this.slots.map(s => s.active).filter(Boolean)]) if (task.owner === owner) {
      Atomics.store(task.cancel, 0, 1); task.done = true; task.value = { canceled: true };
    }
    this.queue = this.queue.filter(t => !t.done); this.drain();
  }
  fail() {
    if (this.closed) return; this.closed = true;
    for (const task of [...this.queue, ...this.slots.map(s => s.active).filter(Boolean)]) {
      Atomics.store(task.cancel, 0, 1); task.done = true; task.value = { error: 'worker-unavailable' };
    }
    this.queue = [];
    for (const slot of this.slots) { slot.port.close(); void slot.worker.terminate(); }
  }
  close() { this.fail(); }
}

export function forecastPool(m) {
  if (m.opts.BattleClass || m.battleContent !== 'full' || !m.data?.chess) return null;
  // Normal production rooms share one frozen data identity. Foreign/injected sources retain serial behavior.
  if (singleton && singleton.data !== m.data) return null;
  if (!singleton) { try { singleton = new ForecastWorkerPool(m.data); } catch { return null; } }
  return singleton.closed ? null : singleton;
}
export function closeForecastWorkers() { singleton?.close(); singleton = null; }
