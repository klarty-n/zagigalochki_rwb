import pg from 'pg';
import { createCoreProvider } from './core.mjs';
import { martEntities } from './model.mjs';
import { InputError } from './analytics.mjs';

// All filtering uses parameters. Buyer state is NOT seller state.
export function createMartProvider(connectionString) {
  if (!connectionString) throw new Error('Для DATA_SOURCE=mart требуется DATABASE_URL.');
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  let details;
  return {
    async getOverview(filters) {
      const client = await pool.connect();
      const args = [`${filters.start}-01`, `${filters.end}-01`, filters.state];
      const scope = `month >= $1::date AND month < $2::date + interval '1 month'
        AND ($3::text = 'all' OR buyer_state = $3)`;
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        const regions = (await client.query(`SELECT DISTINCT buyer_state FROM mart.order_metrics
          WHERE buyer_state IS NOT NULL ORDER BY buyer_state`)).rows.map(r => r.buyer_state);
        if (filters.state !== 'all' && !regions.includes(filters.state)) throw new InputError('Штат отсутствует в данных.');
        const k = (await client.query(`WITH scoped AS (
          SELECT * FROM mart.order_metrics WHERE ${scope}
        ), buyers AS (SELECT customer_unique_id, COUNT(*) AS n FROM scoped GROUP BY customer_unique_id)
        SELECT COUNT(*) AS "allOrders",
          COUNT(*) FILTER(WHERE order_status='delivered') AS "deliveredOrders",
          COALESCE(SUM(product_value) FILTER(WHERE order_status='delivered'),0)*100 AS "revenueCents",
          ROUND(AVG(order_value) FILTER(WHERE order_status='delivered' AND has_items)*100) AS "averageOrderCents",
          AVG(units) FILTER(WHERE order_status='delivered' AND has_items) AS "averageUnits",
          AVG(item_lines) FILTER(WHERE order_status='delivered' AND has_items) AS "averageLines",
          (SELECT COUNT(*) FROM buyers) AS customers,
          (SELECT COUNT(*) FROM buyers WHERE n>=2) AS "repeatBuyers",
          (SELECT 100.0*COUNT(*) FILTER(WHERE n>=2)/NULLIF(COUNT(*),0) FROM buyers) AS "repeatPercent"
        FROM scoped`, args)).rows[0];
        const monthly = (await client.query(`WITH calendar AS (
          SELECT generate_series($1::date,$2::date,interval '1 month')::date AS month
        ), sales AS (
          SELECT month, COUNT(*) AS orders,SUM(product_value)*100 AS revenue
          FROM mart.order_metrics WHERE ${scope} AND order_status='delivered' GROUP BY month
        ) SELECT to_char(c.month,'YYYY-MM') AS month,COALESCE(s.orders,0) AS orders,
          COALESCE(s.revenue,0) AS "revenueCents" FROM calendar c LEFT JOIN sales s USING(month) ORDER BY c.month`, args)).rows;
        const sellers = (await client.query(`SELECT seller_id AS id,seller_city AS city,seller_state AS state,
          SUM(price)*100 AS "revenueCents", COUNT(*) AS units, COUNT(DISTINCT order_id) AS orders
          FROM mart.delivered_items WHERE ${scope} GROUP BY seller_id,seller_city,seller_state
          ORDER BY SUM(price) DESC,seller_id LIMIT 10`, args)).rows;
        const categories = (await client.query(`SELECT category_code AS id,category AS name,
          SUM(revenue)*100 AS "revenueCents",COALESCE(100.0*SUM(revenue)/NULLIF(SUM(SUM(revenue)) OVER(),0),0) AS share
          FROM mart.category_sales_cached WHERE ${scope} GROUP BY category_code,category
          ORDER BY SUM(revenue) DESC,category_code NULLS LAST`, args)).rows;
        const freshness = (await client.query(`SELECT last_success_at,last_attempt_at,last_error
          FROM mart.refresh_state WHERE name='category_sales_cached'`)).rows[0];
        await client.query('COMMIT');
        const numbers = row => Object.fromEntries(Object.entries(row).map(([key,value]) =>
          [key, value === null ? null : Number(value)]));
        const mixed = (row,keys) => ({ ...row, ...numbers(Object.fromEntries(keys.map(k => [k,row[k]]))) });
        return {
          meta: { source: 'mart', loadedAt: new Date().toISOString(), currency: 'BRL', filters,
            categoryMartRefreshedAt: freshness?.last_success_at?.toISOString() ?? null,
            categoryMartWarning: Boolean(freshness?.last_error),
            period: { start: '2016-09', end: '2018-08' } },
          kpis: numbers(k), monthly: monthly.map(r => mixed(r,['orders','revenueCents'])),
          sellers: sellers.map(r => mixed(r,['orders','units','revenueCents'])),
          categories: categories.map(r => mixed(r,['revenueCents','share'])), regions,
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    },
    async getData() {
      details ??= createCoreProvider(connectionString);
      return details.getData();
    },
    async getMartModel() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15000ms'");
        // Counting all eight views at once exceeds small Docker /dev/shm with parallel plans.
        await client.query('SET LOCAL max_parallel_workers_per_gather = 0');
        // Relation names come exclusively from the code-owned contract, never the request.
        const counts = await client.query(martEntities.map(e =>
          `SELECT '${e.id}' AS id, count(*)::int AS count FROM mart.${e.id}`).join(' UNION ALL '));
        const columns = await client.query(`SELECT table_name,column_name,data_type,is_nullable
          FROM information_schema.columns WHERE table_schema='mart' ORDER BY table_name,ordinal_position`);
        await client.query('COMMIT');
        return { counts: Object.fromEntries(counts.rows.map(r => [r.id,r.count])),
          fields: Object.fromEntries(martEntities.map(e => [e.id,columns.rows.filter(r => r.table_name===e.id)
            .map(r => ({name:r.column_name,type:r.data_type,role:'',nullable:r.is_nullable==='YES'}))])) };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    close: async () => { await pool.end(); if (details) await details.close(); },
  };
}
