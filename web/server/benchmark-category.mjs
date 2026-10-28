import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const connectionString = process.env.DATABASE_URL || 'postgresql://hack:hack@localhost:5432/marketplace';
const defaultReport = resolve(dirname(fileURLToPath(import.meta.url)), '../../reports/scaling/category_benchmark.json');
const reportArg = process.argv.indexOf('--report');
const reportPath = reportArg >= 0 ? process.argv[reportArg+1] : defaultReport;
if (!reportPath) throw new Error('Usage: benchmark-category.mjs [--report path]');
const client = new pg.Client({ connectionString });
const core = `SELECT snap.category_name AS category_code,
  COALESCE(NULLIF(btrim(c.category_name_english),''),snap.category_name,'Не указана') AS category,
  SUM(i.price) AS revenue, COUNT(*) AS units
  FROM core.order_items i
  JOIN core.orders o USING(order_id)
  JOIN core.order_address_snapshot addr USING(order_id)
  JOIN core.order_item_category_snapshot snap USING(order_id,order_item_id)
  LEFT JOIN core.categories c ON c.category_name=snap.category_name
  WHERE o.order_status='delivered'
  GROUP BY snap.category_name,c.category_name_english
  ORDER BY category_code NULLS LAST`;
const cached = `SELECT category_code,category,SUM(revenue) AS revenue,SUM(units) AS units
  FROM mart.category_sales_cached GROUP BY category_code,category
  ORDER BY category_code NULLS LAST`;
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
const normalized = rows => rows.map(r => [r.category_code,r.category,Number(r.revenue),Number(r.units)])
  .sort((a,b) => String(a[0]).localeCompare(String(b[0])));
try {
  await client.connect();
  const [coreRows, cachedRows] = await Promise.all([client.query(core),client.query(cached)]);
  const equal = JSON.stringify(normalized(coreRows.rows)) === JSON.stringify(normalized(cachedRows.rows));
  if (!equal) throw new Error('Core and stored mart results differ; benchmark aborted');
  const times = { core: [], cached: [] };
  for (let round=0; round<8; round++) {
    for (const [name,sql] of (round%2 ? [['cached',cached],['core',core]] : [['core',core],['cached',cached]])) {
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
      if (round>0) times[name].push(plan.rows[0]['QUERY PLAN'][0]['Execution Time']);
    }
  }
  const size = await client.query(`SELECT pg_size_pretty(pg_total_relation_size('core.order_items')) AS core_items,
    pg_size_pretty(pg_total_relation_size('mart.category_sales_cached')) AS category_cache`);
  const environment = await client.query(`SELECT version() AS postgres_version,
    (SELECT COUNT(*) FROM core.order_items) AS core_item_rows,
    (SELECT COUNT(*) FROM mart.category_sales_cached) AS cached_rows,
    (SELECT last_success_at FROM mart.refresh_state WHERE name='category_sales_cached') AS cached_refreshed_at`);
  const pool = new pg.Pool({ connectionString, max: 10 });
  const requestMs = [];
  try {
    await Promise.all(Array.from({length:10},() => pool.query(cached)));
    for (let round=0; round<3; round++) {
      const batch = await Promise.all(Array.from({length:10},async () => {
        const started = performance.now();
        await pool.query(cached);
        return performance.now()-started;
      }));
      requestMs.push(...batch);
    }
  } finally { await pool.end(); }
  const sorted = [...requestMs].sort((a,b) => a-b);
  const p95 = sorted[Math.ceil(sorted.length*0.95)-1];
  const report = {measuredAtUtc:new Date().toISOString(),sameResult:equal,categoryCount:coreRows.rowCount,
    coreMedianMs:median(times.core),cachedMedianMs:median(times.cached),
    coreRunsMs:times.core,cachedRunsMs:times.cached,sizes:size.rows[0],
    tenConcurrentP95Ms:Number(p95.toFixed(3)),tenConcurrentRuns:requestMs.length,
    environment:environment.rows[0],
    method:'EXPLAIN ANALYZE: one warm-up and seven alternating runs per query; concurrency: ten warmed connections, three batches of ten queries; p95 is nearest-rank client latency',
    limitation:'Local data and SQL-only tests; no browser/API load, network, future data size or server capacity measured.'};
  mkdirSync(dirname(reportPath),{recursive:true});
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,reportPath},null,2));
} catch (error) { console.error(error); process.exitCode=1; }
finally { await client.end(); }
