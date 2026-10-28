import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoData } from './demo.mjs';
import { parseFilters, summarize } from './analytics.mjs';
import { createApp } from './app.mjs';

const item = (productId, sellerId, priceCents, freightCents, categoryId = 'known') => ({ productId, sellerId, priceCents, freightCents, categoryId });
const fixture = {
  source: 'demo', loadedAt: '2026-10-28T00:00:00.000Z',
  sellers: [{ id: 's1', city: 'São Paulo', state: 'SP' }, { id: 's2', city: 'Recife', state: 'PE' }],
  categories: [{ id: 'known', name: 'Известна' }, { id: null, name: 'Не указана' }],
  orders: [
    { id: 'o1', purchasedAt: '2017-01-10', buyerId: 'b1', state: 'SP', status: 'delivered', items: [item('p1', 's1', 10000, 1000), item('p1', 's1', 10000, 1000), item('p2', 's2', 5000, 500, null)] },
    { id: 'o2', purchasedAt: '2017-02-10', buyerId: 'b1', state: 'SP', status: 'canceled', items: [item('p1', 's1', 99900, 500)] },
    { id: 'o3', purchasedAt: '2017-02-15', buyerId: 'b2', state: 'RJ', status: 'delivered', items: [item('p3', 's2', 7000, 1000)] },
    { id: 'o4', purchasedAt: '2017-02-20', buyerId: 'b3', state: 'SP', status: 'shipped', items: [] },
  ],
};

test('grain, freight, statuses, repeat identity and unknown category stay consistent', () => {
  const data = summarize(fixture, parseFilters({ start: '2017-01', end: '2017-03' }));
  assert.equal(data.kpis.revenueCents, 32000);
  assert.equal(data.kpis.averageOrderCents, 17750);
  assert.equal(data.kpis.deliveredOrders, 2);
  assert.equal(data.kpis.allOrders, 4);
  assert.equal(data.kpis.customers, 3);
  assert.equal(data.kpis.repeatBuyers, 1); // canceled second order still counts as a purchase attempt
  assert.equal(data.kpis.averageUnits, 2);
  assert.equal(data.kpis.averageLines, 1.5); // two same product/seller units = one report line
  assert.deepEqual(data.monthly.at(-1), { month: '2017-03', orders: 0, revenueCents: 0 });
  assert.equal(data.sellers.find(s => s.id === 's1').revenueCents, 20000);
  assert.equal(data.sellers.find(s => s.id === 's1').orders, 1);
  assert.equal(data.sellers.reduce((sum, s) => sum + s.revenueCents, 0), data.kpis.revenueCents);
  assert.equal(data.categories.reduce((sum, c) => sum + c.revenueCents, 0), data.kpis.revenueCents);
  assert.equal(data.categories.find(c => c.id === null).revenueCents, 5000);
});

test('region is buyer region, period filters all metrics, empty ratio is null', () => {
  const data = summarize(fixture, parseFilters({ start: '2017-01', end: '2017-01', state: 'SP' }));
  assert.equal(data.kpis.revenueCents, 25000);
  assert.equal(data.kpis.repeatBuyers, 0);
  assert.equal(data.sellers.find(s => s.id === 's2').state, 'PE');
  const empty = summarize(fixture, parseFilters({ start: '2016-11', end: '2016-11' }));
  assert.equal(empty.kpis.averageOrderCents, null);
  assert.equal(empty.kpis.repeatPercent, null);
  assert.equal(empty.monthly.length, 1);
});

test('deterministic demo, 24 months, November zero and totals reconcile', () => {
  const demo = makeDemoData();
  assert.deepEqual(demo.orders, makeDemoData().orders);
  const data = summarize(demo, parseFilters());
  assert.equal(data.monthly.length, 24);
  assert.deepEqual(data.monthly.find(p => p.month === '2016-11'), { month: '2016-11', orders: 0, revenueCents: 0 });
  assert.equal(data.monthly.reduce((sum, p) => sum + p.revenueCents, 0), data.kpis.revenueCents);
  assert.equal(data.categories.reduce((sum, c) => sum + c.revenueCents, 0), data.kpis.revenueCents);
  assert.equal(data.monthly.reduce((sum, p) => sum + p.orders, 0), data.kpis.deliveredOrders);
});

test('invalid query values are rejected before database access', () => {
  for (const query of [{ start: '2016-13' }, { start: '2018-05', end: '2017-01' }, { start: '2015-01' }, { state: "SP'; DROP TABLE raw.orders;--" }, { state: ['SP', 'RJ'] }]) {
    assert.throws(() => parseFilters(query));
  }
});

test('API validates inputs and never replaces a failing core provider with demo', async t => {
  const server = createApp({ getData: async () => { throw new Error('not connected'); } }, 'core').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bad = await fetch(`${base}/api/overview?start=oops`);
  assert.equal(bad.status, 400);
  const unavailable = await fetch(`${base}/api/overview`);
  assert.equal(unavailable.status, 503);
  const failure = await unavailable.json();
  assert.match(failure.error, /Не удалось обновить аналитику/);
  assert.equal(failure.kpis, undefined);
  assert.equal((await fetch(`${base}/api/nonexistent`)).status, 404);
});

test('API supplies demo overview and respects region filters', async t => {
  const demo = makeDemoData();
  const server = createApp({ getData: async () => demo }, 'demo').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/overview?start=2017-01&end=2017-01&state=SP`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.meta.source, 'demo');
  assert.equal(result.monthly.length, 1);
  assert.equal(result.meta.filters.state, 'SP');
  assert.equal((await fetch(`${base}/api/overview?state=ZZ`)).status, 400);
});
