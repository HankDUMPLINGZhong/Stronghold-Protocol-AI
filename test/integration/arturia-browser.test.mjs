import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional browser smoke against the running, installed upstream server.
test('room controls add Arturia, disable duplicates and show her committed first pick', {
  skip: process.env.ARTURIA_E2E !== '1', timeout: 120_000,
}, async () => {
  process.env.CHROME_PATH ||= 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const root = resolve(process.env.ARTURIA_GAME || '.cache/arturia-upstream');
  const { Client } = await import(pathToFileURL(resolve(root, 'test/e2e/client.mjs')));
  const P = (await import('puppeteer-core')).default;
  const client = new Client(P, process.env.ARTURIA_URL || 'http://127.0.0.1:3007', 'arturia', { w: 1600, h: 1000 });
  const shots = resolve('.cache/arturia-shots'); mkdirSync(shots, { recursive: true });
  try {
    await client.open(); await client.enter('阿尔图罗测试');
    await client.click('.mode-card', '同盟模拟');
    await client.click('.diff-card', '绝境模拟');
    await client.click('.create-box button', '创建同盟');
    await client.waitFor(s => !!s.room?.code, 'room');
    await client.page.screenshot({ path: resolve(shots, 'room-before.png') });
    assert.equal(await client.page.$$eval('[role="menu"]', nodes => nodes.length), 0);
    await client.click('.seat--empty button', '添加精英干员');
    await client.page.waitForSelector('[role="menuitem"]');
    assert.deepEqual(await client.page.$$eval('[role="menuitem"]', nodes => nodes.map(n => n.textContent.trim())), ['阿尔图罗']);
    await client.page.screenshot({ path: resolve(shots, 'elite-menu.png') });
    await client.page.keyboard.press('Escape');
    await client.page.waitForFunction(() => !document.querySelector('[role="menu"]'));
    await client.page.keyboard.press('ArrowDown');
    await client.page.waitForSelector('[role="menuitem"]');
    await client.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem');
    await client.page.keyboard.press('Enter');
    await client.page.waitForFunction(() => globalThis.__SP__.store.get().room.seats.some(s => s?.botPersona === 'arturia'));
    const duplicateButtons = await client.page.$$eval('.seat--empty button', nodes => nodes.filter(n => n.textContent.includes('添加精英干员')).map(n => n.disabled));
    assert.ok(duplicateButtons.length && duplicateButtons.every(Boolean));
    assert.equal(await client.page.$$eval('.seat--empty small', nodes => nodes.length), 0, 'no strategy explanation in empty seats');
    await client.page.waitForFunction(() => [...document.querySelectorAll('.seat .avatar img')].some(img => img.currentSrc.includes('char_245_cello') && img.complete && img.naturalWidth > 0));
    await client.page.screenshot({ path: resolve(shots, 'room-after.png') });
    await client.click('.room-screen button', '开始模拟');
    await client.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
    await client.click('.brief__foot button', '准备就绪');
    await client.waitFor(s => s.phase === 'BAND_DRAFT', 'band');
    await client.page.waitForFunction(() => {
      const p = globalThis.__SP__.store.get().match.public;
      return p?.players?.some(s => s.name === 'AI·阿尔图罗' && s.bandId === 'band_paganini');
    });
    const order = await client.page.$$eval('.dorder__name', nodes => nodes.map(n => n.textContent));
    assert.match(order[0], /阿尔图罗/);
    await client.page.screenshot({ path: resolve(shots, 'draft.png') });
    assert.deepEqual(client.problems.filter(s => s.startsWith('pageerror:')), []);
  } catch (error) {
    console.error(client.problems);
    if (client.page) await client.page.screenshot({ path: resolve(shots, 'failure.png') }).catch(() => {});
    throw error;
  } finally { await client.close(); }
});
