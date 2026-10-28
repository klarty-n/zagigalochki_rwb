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
