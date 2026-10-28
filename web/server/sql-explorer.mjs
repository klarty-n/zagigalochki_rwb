import { orderDetail } from './explorer.mjs';

const timestamp = column => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const numberFields = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
  [key, ['units','sellers','productCents','freightCents','totalCents'].includes(key) && value !== null ? Number(value) : value]));

// Each request returns one page, one order, or aggregate check results. Never all core records.
export function createSqlExplorer(pool) {
  async function read(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '15000ms'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return {
    getOrders(query) {
      return read(async client => {
        const args = [`${query.start}-01`, `${query.end}-01`, query.state, query.status, query.q];
        const scope = `o.order_purchase_at >= $1::date AND o.order_purchase_at < $2::date + interval '1 month'
          AND ($3::text='all' OR a.state=$3)`;
        const filter = `${scope} AND ($4::text='all' OR o.order_status=$4)
          AND ($5::text='' OR strpos(lower(o.order_id),$5)>0)`;
        if (query.state !== 'all') {
          const found = await client.query('SELECT 1 FROM core.order_address_snapshot WHERE state=$1 LIMIT 1', [query.state]);
          if (!found.rowCount) { const { InputError } = await import('./analytics.mjs'); throw new InputError('Штат отсутствует в данных.'); }
        }
        const statusCounts = Object.fromEntries((await client.query(`SELECT o.order_status,count(*)::int AS n
          FROM core.orders o LEFT JOIN core.order_address_snapshot a USING(order_id)
          WHERE ${scope} GROUP BY o.order_status ORDER BY o.order_status`, args.slice(0,3))).rows.map(r => [r.order_status,r.n]));
        const total = Number((await client.query(`SELECT count(*) AS n FROM core.orders o
          LEFT JOIN core.order_address_snapshot a USING(order_id) WHERE ${filter}`, args)).rows[0].n);
        const pages = Math.max(1, Math.ceil(total/query.pageSize)), page = Math.min(query.page,pages);
        // Sort fragments are code-owned, while all user values remain bound parameters.
        const sort = {date_desc:'o.order_purchase_at DESC,o.order_id',date_asc:'o.order_purchase_at,o.order_id',amount_desc:'amount.total DESC NULLS LAST,o.order_id'}[query.sort];
        const amountJoin = query.sort === 'amount_desc'
          ? 'LEFT JOIN (SELECT order_id,SUM(price+freight_value) AS total FROM core.order_items GROUP BY order_id) amount USING(order_id)' : '';
        const rows = await client.query(`WITH selected AS (
          SELECT o.*,a.city,a.state, row_number() OVER (ORDER BY ${sort}) AS position
          FROM core.orders o LEFT JOIN core.order_address_snapshot a USING(order_id) ${amountJoin}
          WHERE ${filter} ORDER BY ${sort} LIMIT $6 OFFSET $7
        ) SELECT o.order_id AS id,${timestamp('o.order_purchase_at')} AS "purchasedAt",o.order_status AS status,
          o.city,o.state,items.units,items.sellers,COALESCE(items.product,0)*100 AS "productCents",
          COALESCE(items.freight,0)*100 AS "freightCents",items.total*100 AS "totalCents",
          ${timestamp('o.delivered_customer_at')} AS "deliveredAt",to_char(o.estimated_delivery_date,'YYYY-MM-DD') AS "estimatedAt"
        FROM selected o LEFT JOIN LATERAL (
          SELECT count(*)::int AS units,count(DISTINCT seller_id)::int AS sellers,SUM(price) AS product,
            SUM(freight_value) AS freight,SUM(price+freight_value) AS total
          FROM core.order_items WHERE order_id=o.order_id
        ) items ON true ORDER BY o.position`, [...args,query.pageSize,(page-1)*query.pageSize]);
        return {meta:{source:'core',loadedAt:new Date().toISOString()},total,page,pages,pageSize:query.pageSize,statusCounts,items:rows.rows.map(numberFields)};
      });
    },
    getOrderDetail(id) {
      return read(async client => {
        const result = await client.query(`SELECT o.order_id AS id,o.customer_id AS "customerId",c.customer_unique_id AS "buyerId",
          a.city,a.state,o.order_status AS status,${timestamp('o.order_purchase_at')} AS "purchasedAt",
          ${timestamp('o.order_approved_at')} AS "approvedAt",${timestamp('o.delivered_carrier_at')} AS "carrierAt",
          ${timestamp('o.delivered_customer_at')} AS "deliveredAt",to_char(o.estimated_delivery_date,'YYYY-MM-DD') AS "estimatedAt"
          FROM core.orders o JOIN core.customers c USING(customer_id)
          LEFT JOIN core.order_address_snapshot a USING(order_id) WHERE o.order_id=$1`,[id]);
        if (!result.rowCount) return null;
        const o = result.rows[0];
        o.items = (await client.query(`SELECT i.order_item_id AS "itemId",i.product_id AS "productId",i.seller_id AS "sellerId",
          snap.category_name AS "categoryId",(i.price*100)::int AS "priceCents",(i.freight_value*100)::int AS "freightCents",
          ${timestamp('i.shipping_limit_at')} AS "shippingLimitAt",s.city,s.state,
          COALESCE(c.category_name_english,snap.category_name,'Не указана') AS category
          FROM core.order_items i LEFT JOIN core.order_item_category_snapshot snap USING(order_id,order_item_id)
          LEFT JOIN core.sellers s USING(seller_id) LEFT JOIN core.categories c ON c.category_name=snap.category_name
          WHERE i.order_id=$1 ORDER BY i.order_item_id`,[id])).rows;
        o.payments = (await client.query(`SELECT payment_sequential AS sequential,payment_type AS type,
          payment_installments AS installments,(payment_value*100)::int AS "valueCents"
          FROM core.order_payments WHERE order_id=$1 ORDER BY payment_sequential`,[id])).rows;
        o.reviews = (await client.query(`SELECT review_id AS id,review_score AS score,comment_title AS title,comment_message AS message,
          ${timestamp('review_created_at')} AS "createdAt",${timestamp('review_answered_at')} AS "answeredAt"
          FROM core.order_reviews WHERE order_id=$1 ORDER BY review_id`,[id])).rows;
        return orderDetail({source:'core',loadedAt:new Date().toISOString(),orders:[o],
          sellers:o.items.map(i=>({id:i.sellerId,city:i.city,state:i.state})),
          categories:o.items.map(i=>({id:i.categoryId,name:i.category}))},id);
      });
    },
    getQuality() {
      return read(async client => {
        const defs = [
          ['order-key','Уникальность заказов','order_id однозначно определяет заказ.','fail','заказов',`SELECT order_id AS id FROM core.orders GROUP BY order_id HAVING count(*)>1`],
          ['item-key','Ключи позиций','Пара (order_id, order_item_id) уникальна.','fail','позиций',`SELECT order_id AS id FROM core.order_items GROUP BY order_id,order_item_id HAVING count(*)>1`],
          ['links','Связи позиций со справочниками','У каждой позиции существуют продавец и товар.','fail','позиций',`SELECT i.order_id AS id FROM core.order_items i LEFT JOIN core.products p USING(product_id) LEFT JOIN core.sellers s USING(seller_id) WHERE p.product_id IS NULL OR s.seller_id IS NULL`],
          ['missing-delivery','Дата вручения у delivered','Статус не заменяет дату вручения. Выручка учитывается по статусу.','warn','заказов',`SELECT order_id AS id FROM core.orders WHERE order_status='delivered' AND delivered_customer_at IS NULL`],
          ['chronology','Последовательность дат','Даты событий должны соответствовать их последовательности. Наблюдение не исправляет статус автоматически.','warn','заказов',`SELECT order_id AS id FROM core.orders WHERE order_approved_at<order_purchase_at OR delivered_carrier_at<order_purchase_at OR delivered_customer_at<delivered_carrier_at`],
          ['category-missing','Категория не указана','Позиции сохраняются в группе «Не указана», категория берётся из снимка на момент продажи.','warn','позиций',`SELECT i.order_id AS id FROM core.order_items i LEFT JOIN core.order_item_category_snapshot snap USING(order_id,order_item_id) WHERE snap.category_name IS NULL`],
          ['payment-missing','Отсутствуют записи оплаты','Нет записи — сумма оплаты неизвестна, а не равна нулю.','warn','заказов',`SELECT o.order_id AS id FROM core.orders o WHERE NOT EXISTS(SELECT 1 FROM core.order_payments p WHERE p.order_id=o.order_id)`],
          ['payment-difference','Сверка чека и оплаты','Суммы позиций с доставкой и платежей агрегируются отдельно. Рассрочка не умножает сумму.','warn','заказов',`SELECT i.order_id AS id FROM (SELECT order_id,SUM(price+freight_value) AS total FROM core.order_items GROUP BY order_id) i JOIN (SELECT order_id,SUM(payment_value) AS total FROM core.order_payments GROUP BY order_id) p USING(order_id) WHERE i.total<>p.total`],
          ['review-score','Диапазон оценки отзыва','Ожидается целая оценка от 1 до 5.','fail','отзывов',`SELECT order_id AS id FROM core.order_reviews WHERE review_score IS NULL OR review_score NOT BETWEEN 1 AND 5`],
        ];
        const checks = [];
        for (const [id,name,description,level,unit,sql] of defs) {
          const r = (await client.query(`WITH bad AS MATERIALIZED (${sql}) SELECT count(*)::int AS affected,
            ARRAY(SELECT DISTINCT id FROM bad ORDER BY id LIMIT 5) AS samples FROM bad`)).rows[0];
          checks.push({id,name,description,unit,...r,status:r.affected?level:'pass'});
        }
        const reconciliation = await client.query(`WITH sold AS MATERIALIZED (
          SELECT i.price,snap.category_name FROM core.order_items i JOIN core.orders o USING(order_id)
          LEFT JOIN core.order_item_category_snapshot snap USING(order_id,order_item_id)
          WHERE o.order_status='delivered' AND o.order_purchase_at >= date '2016-09-01' AND o.order_purchase_at < date '2018-09-01'
        ), categories AS (SELECT category_name,SUM(price) AS revenue FROM sold GROUP BY category_name)
        SELECT COALESCE((SELECT SUM(revenue) FROM categories),0)=COALESCE((SELECT SUM(i.price) FROM core.order_items i
          JOIN core.orders o USING(order_id) WHERE o.order_status='delivered' AND o.order_purchase_at>=date '2016-09-01'
          AND o.order_purchase_at<date '2018-09-01'),0) AS ok`);
        const ok = reconciliation.rows[0].ok;
        checks.push({id:'category-reconciliation',name:'Сверка выручки по категориям',description:'Сумма всех категорий, включая неизвестную, равна общей выручке за тот же период.',status:ok?'pass':'fail',affected:ok?0:1,samples:[],unit:'расхождений'});
        checks.push({id:'raw-core',name:'Полнота переноса raw → core',description:'Проверка загрузчика выполняется отдельно. Этот API не читает raw.',status:'not-run',affected:null,samples:[],unit:''});
        const orderCount = (await client.query('SELECT count(*)::int AS n FROM core.orders')).rows[0].n;
        const now = new Date().toISOString();
        return {meta:{source:'core',loadedAt:now},checkedAt:now,orderCount,checks,
          summary:{pass:checks.filter(c=>c.status==='pass').length,warn:checks.filter(c=>c.status==='warn').length,
            fail:checks.filter(c=>c.status==='fail').length,notRun:checks.filter(c=>c.status==='not-run').length}};
      });
    },
  };
}
