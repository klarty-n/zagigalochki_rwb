import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoData } from './demo.mjs';
import { inspectQuality, listOrders, orderDetail, parseOrderQuery } from './explorer.mjs';
import { modelPayload } from './model.mjs';
import { createApp } from './app.mjs';

test('orders are filtered, sorted, paginated and never leak all detail records', () => {
  const data = makeDemoData();
  const query = parseOrderQuery({ start: '2018-01', end: '2018-08', state: 'SP', status: 'delivered', pageSize: '3', sort: 'amount_desc' });
  const result = listOrders(data, query);
  assert.equal(result.items.length, 3);
  assert.ok(result.total > 3);
  assert.ok(result.items.every(o => o.status === 'delivered' && o.state === 'SP' && o.purchasedAt >= '2018-01'));
  assert.ok(result.items[0].totalCents >= result.items[1].totalCents);
  assert.equal(result.items[0].payments, undefined);
  const second = listOrders(data, { ...query, page: 2 });
  assert.ok(!second.items.some(o => result.items.some(first => first.id === o.id)));
  assert.equal(listOrders(data, { ...query, q: 'does-not-exist' }).total, 0);
});

test('detail keeps split payments separate, missing payments unknown and events factual', () => {
  const data = makeDemoData();
  const split = data.orders.find(o => o.payments.length === 2 && o.items.length > 1);
  const detail = orderDetail(data, split.id);
  assert.equal(detail.items.length, split.items.length);
  assert.equal(detail.payments.length, 2);
  assert.equal(detail.order.productCents, split.items.reduce((s, i) => s + i.priceCents, 0));
  assert.equal(detail.order.paidCents, split.payments.reduce((s, p) => s + p.valueCents, 0));
  const missing = data.orders.find(o => o.status === 'delivered' && !o.deliveredAt && !o.payments.length);
  const missingDetail = orderDetail(data, missing.id);
  assert.equal(missingDetail.order.paidCents, null);
  assert.equal(missingDetail.order.paymentDifferenceCents, null);
  assert.equal(missingDetail.events.find(e => e.key === 'delivered').at, null);
  assert.equal(orderDetail(data, 'absent'), null);
});

test('checks reflect input defects and never claim raw/core reconciliation ran', () => {
  const data = makeDemoData();
  const clean = inspectQuality(data);
  assert.equal(clean.checks.find(c => c.id === 'raw-core').status, 'not-run');
  assert.equal(clean.checks.find(c => c.id === 'order-key').status, 'pass');
  assert.ok(clean.checks.find(c => c.id === 'missing-delivery').affected > 0);
  assert.ok(clean.checks.find(c => c.id === 'category-missing').samples.length > 0);
  data.orders[0].items.push({ ...data.orders[0].items[0] });
  data.orders.push(data.orders[0]);
  const broken = inspectQuality(data);
  assert.equal(broken.checks.find(c => c.id === 'order-key').status, 'fail');
  assert.equal(broken.checks.find(c => c.id === 'item-key').status, 'fail');
});

test('model separates documented schema from current counts and offline counts are unknown', () => {
  const data = makeDemoData();
  const model = modelPayload(data, 'demo');
  assert.equal(model.entities.length, 8);
  assert.equal(model.entities.find(e => e.id === 'order_payments').count, data.orders.reduce((s, o) => s + o.payments.length, 0));
  const offline = modelPayload(null, 'core');
  assert.equal(offline.available, false);
  assert.ok(offline.entities.every(e => e.count === null));
  assert.ok(offline.entities.find(e => e.id === 'order_reviews').fields.some(f => f.name === 'review_created_at' && f.type === 'timestamp'));
});

test('order query rejects oversized search, malformed status and unsafe pagination', () => {
  for (const q of [{ pageSize: '1000' }, { page: '-1' }, { page: ['1', '2'] }, { q: 'x'.repeat(129) }, { status: 'unknown' }, { sort: 'random' }]) assert.throws(() => parseOrderQuery(q));
});

test('API exposes list/detail/checks/model with 404, validation and offline behavior', async t => {
  const data = makeDemoData();
  const server = createApp({ getData: async () => data }, 'demo').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const list = await (await fetch(`${base}/api/orders?pageSize=2`)).json();
  assert.equal(list.items.length, 2);
  const detail = await (await fetch(`${base}/api/orders/${list.items[0].id}`)).json();
  assert.equal(detail.order.id, list.items[0].id);
  assert.equal((await fetch(`${base}/api/orders/not-found`)).status, 404);
  assert.equal((await fetch(`${base}/api/orders?pageSize=500`)).status, 400);
  const quality = await (await fetch(`${base}/api/quality`)).json();
  assert.equal(quality.meta.source, 'demo');
  assert.equal(quality.orderCount, data.orders.length);
  assert.equal((await (await fetch(`${base}/api/model`)).json()).entities.length, 8);
});

test('offline core keeps schema accessible but orders and checks fail explicitly', async t => {
  const server = createApp({ getData: async () => { throw new Error('offline'); } }, 'core').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const model = await (await fetch(`${base}/api/model`)).json();
  assert.equal(model.source, 'core');
  assert.equal(model.available, false);
  assert.equal((await fetch(`${base}/api/orders`)).status, 503);
  assert.equal((await fetch(`${base}/api/quality`)).status, 503);
});
