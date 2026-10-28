import { InputError, parseFilters, summarize } from './analytics.mjs';

export function scopedOrders(data, filters) {
  return data.orders.filter(o => o.purchasedAt.slice(0, 7) >= filters.start && o.purchasedAt.slice(0, 7) <= filters.end && (filters.state === 'all' || o.state === filters.state));
}
const statuses = ['delivered', 'shipped', 'canceled', 'unavailable', 'invoiced', 'processing', 'created', 'approved'];
export function parseOrderQuery(query = {}) {
  const filters = parseFilters(query);
  const q = query.q ?? '', status = query.status ?? 'all', sort = query.sort ?? 'date_desc';
  if (typeof q !== 'string' || q.length > 128) throw new InputError('Поиск ограничен 128 символами.');
  if (status !== 'all' && !statuses.includes(status)) throw new InputError('Неизвестный статус заказа.');
  if (!['date_desc', 'date_asc', 'amount_desc'].includes(sort)) throw new InputError('Неизвестная сортировка.');
  const numeric = (value, fallback, max) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new InputError('Некорректная пагинация.');
    return Number(value);
  };
  return { ...filters, q: q.trim().toLowerCase(), status, sort, page: numeric(query.page, 1, 1000000), pageSize: numeric(query.pageSize, 20, 100) };
}
export function orderSummary(o) {
  const productCents = o.items.reduce((s, i) => s + i.priceCents, 0);
  const freightCents = o.items.reduce((s, i) => s + i.freightCents, 0);
  return { id: o.id, purchasedAt: o.purchasedAt, status: o.status, city: o.city ?? null, state: o.state,
    units: o.items.length, sellers: new Set(o.items.map(i => i.sellerId)).size,
    productCents, freightCents, totalCents: o.items.length ? productCents + freightCents : null,
    deliveredAt: o.deliveredAt ?? null, estimatedAt: o.estimatedAt ?? null };
}
export function listOrders(data, filters) {
  const scope = scopedOrders(data, filters);
  const counts = Object.fromEntries([...new Set(scope.map(o => o.status))].sort().map(s => [s, scope.filter(o => o.status === s).length]));
  const rows = scope.filter(o => (filters.status === 'all' || o.status === filters.status) && (!filters.q || o.id.toLowerCase().includes(filters.q))).map(orderSummary);
  rows.sort((a, b) => filters.sort === 'amount_desc' ? (b.totalCents ?? -1) - (a.totalCents ?? -1) || a.id.localeCompare(b.id) : (filters.sort === 'date_asc' ? 1 : -1) * a.purchasedAt.localeCompare(b.purchasedAt) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(rows.length / filters.pageSize)), page = Math.min(filters.page, pages);
  return { meta: { source: data.source, loadedAt: data.loadedAt }, total: rows.length, page, pages, pageSize: filters.pageSize,
    statusCounts: counts, items: rows.slice((page - 1) * filters.pageSize, page * filters.pageSize) };
}
export function orderDetail(data, id) {
  const o = data.orders.find(o => o.id === id);
  if (!o) return null;
  const sellers = new Map(data.sellers.map(s => [s.id, s]));
  const categories = new Map(data.categories.map(c => [c.id, c.name]));
  const payments = o.payments ?? [];
  const paidCents = payments.length ? payments.reduce((s, p) => s + p.valueCents, 0) : null;
  const summary = orderSummary(o);
  return { meta: { source: data.source, loadedAt: data.loadedAt }, order: { ...summary, buyerId: o.buyerId, customerId: o.customerId ?? null,
    paidCents, paymentDifferenceCents: paidCents !== null && summary.totalCents !== null ? paidCents - summary.totalCents : null },
    items: o.items.map((i, idx) => ({ ...i, itemId: i.itemId ?? idx + 1,
      category: categories.get(i.categoryId) || i.categoryId || 'Не указана', seller: sellers.get(i.sellerId) ?? null })),
    payments, reviews: o.reviews ?? [], events: [
      { key: 'purchase', label: 'Заказ оформлен', at: o.purchasedAt },
      { key: 'approved', label: 'Оплата подтверждена', at: o.approvedAt ?? null },
      { key: 'carrier', label: 'Передан перевозчику', at: o.carrierAt ?? null },
      { key: 'delivered', label: 'Вручён покупателю', at: o.deliveredAt ?? null },
    ] };
}

export function inspectQuality(data) {
  const orders = data.orders;
  const checks = [];
  const add = (id, name, description, affected, level, samples, unit = 'заказов') => checks.push({ id, name, description, affected,
    status: affected ? level : 'pass', samples: [...new Set(samples)].slice(0, 5), unit });
  const seen = new Set(), duplicateOrders = [];
  for (const o of orders) { if (seen.has(o.id)) duplicateOrders.push(o.id); seen.add(o.id); }
  add('order-key', 'Уникальность заказов', 'order_id должен однозначно определять заказ.', duplicateOrders.length, 'fail', duplicateOrders);
  const badItems = [];
  for (const o of orders) { const seenItems = new Set(); for (const [idx, item] of o.items.entries()) {
    const key = item.itemId ?? idx + 1; if (seenItems.has(key)) badItems.push(o.id); seenItems.add(key);
  } }
  add('item-key', 'Ключи позиций', 'Пара (order_id, order_item_id) уникальна. Одинаковые товары могут быть отдельными единицами.', badItems.length, 'fail', badItems, 'позиций');
  const sellerIds = new Set(data.sellers.map(s => s.id));
  const productIds = data.products ? new Set(data.products.map(p => p.id)) : null;
  const badLinks = orders.flatMap(o => o.items.filter(i => !sellerIds.has(i.sellerId) || (productIds && !productIds.has(i.productId))).map(() => o.id));
  add('links', 'Связи позиций со справочниками', 'У каждой позиции должны существовать продавец и товар. Проверяются данные текущего снимка.', badLinks.length, 'fail', badLinks, 'позиций');
  const missingDelivery = orders.filter(o => o.status === 'delivered' && !o.deliveredAt);
  add('missing-delivery', 'Дата вручения у delivered', 'Статус не заменяет дату: без даты нельзя достоверно рассчитать срок доставки. Выручка продолжает учитываться по статусу.', missingDelivery.length, 'warn', missingDelivery.map(o => o.id));
  const chronology = orders.filter(o => (o.approvedAt && o.approvedAt < o.purchasedAt) || (o.carrierAt && o.carrierAt < o.purchasedAt) || (o.deliveredAt && o.carrierAt && o.deliveredAt < o.carrierAt));
  add('chronology', 'Последовательность дат', 'Подтверждение, передача перевозчику и вручение не должны предшествовать своим предыдущим событиям. Наблюдение не исправляет статус автоматически.', chronology.length, 'warn', chronology.map(o => o.id));
  const withoutCategory = orders.flatMap(o => o.items.filter(i => i.categoryId === null).map(() => o.id));
  add('category-missing', 'Категория не указана', 'Такие позиции сохраняются в группе «Не указана». Это наблюдение качества, а не причина удаления.', withoutCategory.length, 'warn', withoutCategory, 'позиций');
  const noPayments = orders.filter(o => !(o.payments?.length));
  add('payment-missing', 'Отсутствуют записи оплаты', 'Нет записи — сумма оплаты неизвестна, а не равна нулю. В том числе возможны отменённые заказы.', noPayments.length, 'warn', noPayments.map(o => o.id));
  const differentPayments = orders.filter(o => o.payments?.length && o.items.length && o.payments.reduce((s, p) => s + p.valueCents, 0) !== o.items.reduce((s, i) => s + i.priceCents + i.freightCents, 0));
  add('payment-difference', 'Сверка чека и оплаты', 'Сравниваются независимо собранные суммы позиций с доставкой и платежей. Рассрочка не является множителем суммы.', differentPayments.length, 'warn', differentPayments.map(o => o.id));
  const invalidReviews = orders.flatMap(o => (o.reviews ?? []).filter(r => !Number.isInteger(r.score) || r.score < 1 || r.score > 5).map(() => o.id));
  add('review-score', 'Диапазон оценки отзыва', 'Ожидается целая оценка от 1 до 5. Отсутствие отзыва само по себе допустимо.', invalidReviews.length, 'fail', invalidReviews, 'отзывов');
  const total = summarize(data, parseFilters());
  const categoryDifference = total.categories.reduce((s, c) => s + c.revenueCents, 0) - total.kpis.revenueCents;
  add('category-reconciliation', 'Сверка выручки по категориям', 'Сумма всех категорий, включая неизвестную, равна общей выручке того же периода и delivered.', categoryDifference ? 1 : 0, 'fail', [], 'расхождений');
  checks.push({ id: 'raw-core', name: 'Полнота переноса raw → core', description: 'Этот API не читает raw. Сверка количества строк и сумм источника с core выполняется загрузчиком команды и не подтверждается проверками интерфейса.', status: 'not-run', affected: null, samples: [], unit: '' });
  return { meta: { source: data.source, loadedAt: data.loadedAt }, checkedAt: new Date().toISOString(), orderCount: orders.length,
    checks, summary: { pass: checks.filter(c => c.status === 'pass').length, warn: checks.filter(c => c.status === 'warn').length,
      fail: checks.filter(c => c.status === 'fail').length, notRun: checks.filter(c => c.status === 'not-run').length } };
}
