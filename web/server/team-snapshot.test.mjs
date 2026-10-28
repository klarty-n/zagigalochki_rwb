import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamSnapshot, verifyTeamSnapshot } from './team-snapshot.mjs';
import { createApp } from './app.mjs';
test('team snapshot reconciles supplied months, KPI and rankings without invented categories', () => {
  assert.ok(verifyTeamSnapshot().every(c => c.passed));
  assert.equal(teamSnapshot.meta.categoryCount, 74);
  assert.equal(teamSnapshot.categories.length, 11);
  assert.equal(teamSnapshot.kpis.allOrders, null);
  assert.match(teamSnapshot.categories.at(-1).name, /Остальные 64/);
});
test('snapshot API uses saved SQL, never generated orders, and rejects unsupported filters', async t => {
  const server = createApp({ getData: async () => { throw new Error('no order-level data'); } }, 'team-snapshot').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await (await fetch(`${base}/api/overview`)).json();
  assert.equal(result.meta.source, 'team-snapshot');
  assert.equal(result.kpis.revenueCents, 1322149811);
  assert.equal(result.kpis.customers, 96096);
  assert.equal(result.monthly.length, 24);
  assert.equal((await fetch(`${base}/api/overview?state=SP`)).status, 400);
  assert.equal((await fetch(`${base}/api/overview?start=2018-01`)).status, 400);
});
