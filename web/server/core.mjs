import pg from 'pg';

// Contract: origin/feature/core-model 4bc3b28; loader origin/model/load.sql f3d967d.
// No DDL, migrations, raw queries or writes. No implicit fallback to demo.
export function createCoreProvider(connectionString) {
  if (!connectionString) throw new Error('Для DATA_SOURCE=core требуется DATABASE_URL.');
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  let cached;
  let pending;
  async function read() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '15000ms'");
      const orders = await client.query(`
        SELECT o.order_id AS id, to_char(o.order_purchase_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS purchased_at,
               o.customer_id, o.order_status AS status, c.customer_unique_id AS buyer_id, addr.city, addr.state,
               to_char(o.order_approved_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS approved_at,
               to_char(o.delivered_carrier_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS carrier_at,
               to_char(o.delivered_customer_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS delivered_at,
               to_char(o.estimated_delivery_date, 'YYYY-MM-DD') AS estimated_at
        FROM core.orders o
        JOIN core.customers c ON c.customer_id = o.customer_id
        JOIN core.order_address_snapshot addr ON addr.order_id = o.order_id
      `);
      const items = await client.query(`
        SELECT i.order_id, i.order_item_id, i.product_id, i.seller_id, snap.category_name AS category_id,
               to_char(i.shipping_limit_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS shipping_limit_at,
               (i.price * 100)::bigint AS price_cents,
               (i.freight_value * 100)::bigint AS freight_cents
        FROM core.order_items i
        JOIN core.order_item_category_snapshot snap
          ON snap.order_id=i.order_id AND snap.order_item_id=i.order_item_id
      `);
      const sellers = await client.query('SELECT seller_id AS id, city, state FROM core.sellers');
      const categories = await client.query(`SELECT category_name AS id,
        COALESCE(category_name_english, category_name) AS name FROM core.categories`);
      const products = await client.query('SELECT product_id AS id, category_name AS category_id FROM core.products');
      const payments = await client.query(`SELECT order_id, payment_sequential AS sequential, payment_type AS type,
        payment_installments AS installments, (payment_value * 100)::bigint AS value_cents FROM core.order_payments`);
      const reviews = await client.query(`SELECT order_id, review_id AS id, review_score AS score,
        comment_title AS title, comment_message AS message,
        to_char(review_created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
        to_char(review_answered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS answered_at FROM core.order_reviews`);
      const counts = await client.query('SELECT count(*)::int AS customers FROM core.customers');
      await client.query('COMMIT');
      const byOrder = new Map(orders.rows.map(o => [o.id, {
        id: o.id, purchasedAt: o.purchased_at, status: o.status, buyerId: o.buyer_id, customerId: o.customer_id,
        city: o.city, state: o.state, approvedAt: o.approved_at, carrierAt: o.carrier_at,
        deliveredAt: o.delivered_at, estimatedAt: o.estimated_at, items: [], payments: [], reviews: [],
      }]));
      for (const i of items.rows) {
        const order = byOrder.get(i.order_id);
        if (!order) throw new Error('Позиция core ссылается на отсутствующий заказ.');
        const priceCents = Number(i.price_cents), freightCents = Number(i.freight_cents);
        if (!Number.isSafeInteger(priceCents) || !Number.isSafeInteger(freightCents)) throw new Error('Невалидная сумма в core.');
        order.items.push({ itemId: i.order_item_id, productId: i.product_id, sellerId: i.seller_id, categoryId: i.category_id,
          shippingLimitAt: i.shipping_limit_at, priceCents, freightCents });
      }
      for (const p of payments.rows) {
        const order = byOrder.get(p.order_id);
        const valueCents = Number(p.value_cents);
        if (!order || !Number.isSafeInteger(valueCents)) throw new Error('Невалидная запись оплаты core.');
        order.payments.push({ sequential: p.sequential, type: p.type, installments: p.installments, valueCents });
      }
      for (const r of reviews.rows) {
        const order = byOrder.get(r.order_id);
        if (!order) throw new Error('Отзыв ссылается на отсутствующий заказ.');
        order.reviews.push({ id: r.id, score: r.score, title: r.title, message: r.message, createdAt: r.created_at, answeredAt: r.answered_at });
      }
      return { orders: [...byOrder.values()], sellers: sellers.rows,
        products: products.rows.map(p => ({ id: p.id, categoryId: p.category_id })), sourceCounts: counts.rows[0],
        categories: [...categories.rows, { id: null, name: 'Не указана' }], source: 'core', loadedAt: new Date().toISOString() };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return {
    async getData() {
      if (cached && Date.now() - Date.parse(cached.loadedAt) < 60_000) return cached;
      if (!pending) pending = read().then(data => (cached = data)).finally(() => { pending = undefined; });
      return pending;
    },
    close: () => pool.end(),
  };
}
