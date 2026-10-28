import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { createMartProvider } from './mart.mjs';
import { createCoreProvider } from './core.mjs';
import { parseFilters, summarize } from './analytics.mjs';

test('mart overview delegates validated filters without loading core records', async t => {
  let received;
  const server = createApp({
    async getData() { throw new Error('must not load order records'); },
    async getOverview(filters) { received = filters; return { meta: { source: 'mart' }, kpis: { revenueCents: 100 } }; },
  }, 'mart').listen(0,'127.0.0.1');
  await new Promise(r => server.once('listening',r));
  t.after(() => new Promise(r => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/overview`;
  const response = await fetch(`${url}?start=2017-01&end=2017-02&state=SP`);
  assert.equal(response.status,200);
  assert.equal((await response.json()).meta.source,'mart');
  assert.deepEqual(received,{ start:'2017-01',end:'2017-02',state:'SP' });
  assert.equal((await fetch(`${url}?state=invalid`)).status,400);
});

test('mart live SQL matches existing core calculations for totals, filters and empty month', {
  skip: !process.env.MART_TEST_DATABASE_URL,
}, async t => {
  const core = createCoreProvider(process.env.MART_TEST_DATABASE_URL);
  const mart = createMartProvider(process.env.MART_TEST_DATABASE_URL);
  t.after(async () => { await core.close(); await mart.close(); });
  const records = await core.getData();
  for (const query of [{}, {start:'2017-01',end:'2017-03',state:'SP'},
    {start:'2016-11',end:'2016-11'}, {start:'2018-08',end:'2018-08',state:'RJ'}]) {
    const filters = parseFilters(query);
    const expected = summarize(records,filters);
    const actual = await mart.getOverview(filters);
    for (const [key,value] of Object.entries(expected.kpis)) {
      if (['averageUnits','averageLines','repeatPercent'].includes(key) && value !== null) {
        assert.ok(Math.abs(actual.kpis[key]-value)<1e-12, key);
      } else assert.equal(actual.kpis[key],value,key);
    }
    assert.deepEqual(actual.monthly,expected.monthly);
    assert.deepEqual(actual.sellers,expected.sellers);
    assert.equal(actual.categories.length,expected.categories.length);
    for (const category of actual.categories) {
      const ref = expected.categories.find(c => c.id === category.id);
      assert.ok(ref);
      assert.equal(category.revenueCents,ref.revenueCents);
      assert.ok(Math.abs(category.share-ref.share)<1e-10);
    }
    assert.deepEqual(actual.regions,expected.regions);
  }
});

test('mart mode serves real orders, quality and mart lineage with backend credentials', {
  skip: !process.env.MART_TEST_DATABASE_URL,
}, async t => {
  const provider = createMartProvider(process.env.DATABASE_URL || process.env.MART_TEST_DATABASE_URL);
  const server = createApp(provider,'mart').listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));await provider.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=async path=>{const response=await fetch(base+path);assert.equal(response.status,200,path);return response.json();};
  const orders=await get('/api/orders?start=2017-01&end=2017-03&state=SP&pageSize=2');
  assert.equal(orders.items.length,2);
  assert.ok(orders.items.every(o=>o.state==='SP'&&o.purchasedAt>='2017-01'&&o.purchasedAt<'2017-04'));
  const detail=await get(`/api/orders/${orders.items[0].id}`);
  assert.equal(detail.order.id,orders.items[0].id);
  assert.ok(detail.items.length>0);
  assert.ok(Array.isArray(detail.payments)&&Array.isArray(detail.reviews));
  const quality=await get('/api/quality');
  assert.equal(quality.orderCount,99441);
  assert.ok(quality.checks.length>0);
  const model=await get('/api/model');
  assert.equal(model.available,true);
  assert.equal(model.martAvailable,true);
  assert.equal(model.marts.length,8);
  assert.equal(model.entities.find(e=>e.id==='orders').count,99441);
  assert.equal(model.marts.find(e=>e.id==='order_metrics').count,99441);
  assert.ok(model.marts.find(e=>e.id==='monthly_sales').fields.some(f=>f.name==='revenue'));
  assert.ok(model.martRelations.some(r=>r.from==='core.orders'&&r.to==='mart.order_metrics'));
  const overview=await get('/api/overview');
  assert.equal(overview.meta.source,'mart');
  assert.ok(overview.meta.categoryMartRefreshedAt);
  assert.equal(overview.meta.categoryMartWarning,false);
});
