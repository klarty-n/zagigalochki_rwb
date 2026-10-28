import { monthRange } from './demo.mjs';

export class InputError extends Error {}
const validMonth = value => typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);

export function parseFilters(query = {}) {
  const start = query.start ?? '2016-09';
  const end = query.end ?? '2018-08';
  const state = query.state ?? 'all';
  if (!validMonth(start) || !validMonth(end)) throw new InputError('Период должен иметь формат ГГГГ-ММ.');
  if (start > end) throw new InputError('Начало периода должно быть раньше окончания.');
  if (start < '2016-09' || end > '2018-08') throw new InputError('Доступный период: сентябрь 2016 — август 2018.');
  if (typeof state !== 'string' || (state !== 'all' && !/^[A-Z]{2}$/.test(state))) throw new InputError('Некорректный штат.');
  return { start, end, state };
}

export function summarize(data, filters) {
  const { start, end, state } = filters;
  const scoped = data.orders.filter(o => {
    const month = o.purchasedAt.slice(0, 7);
    return month >= start && month <= end && (state === 'all' || o.state === state);
  });
  const monthly = new Map(monthRange(start, end).map(month => [month, { month, orders: 0, revenueCents: 0 }]));
  const sellerStats = new Map();
  const categoryStats = new Map();
  const buyerOrders = new Map();
  let revenueCents = 0, orderTotalCents = 0, ordersWithItems = 0, units = 0, lines = 0, deliveredOrders = 0;
  for (const order of scoped) {
    buyerOrders.set(order.buyerId, (buyerOrders.get(order.buyerId) || 0) + 1);
    if (order.status !== 'delivered') continue;
    deliveredOrders++;
    monthly.get(order.purchasedAt.slice(0, 7)).orders++;
    if (order.items.length) ordersWithItems++;
    const productSellerPairs = new Set();
    for (const item of order.items) {
      revenueCents += item.priceCents;
      orderTotalCents += item.priceCents + item.freightCents;
      units++;
      productSellerPairs.add(JSON.stringify([item.productId, item.sellerId]));
      monthly.get(order.purchasedAt.slice(0, 7)).revenueCents += item.priceCents;
      const seller = sellerStats.get(item.sellerId) || { id: item.sellerId, revenueCents: 0, units: 0, orderIds: new Set() };
      seller.revenueCents += item.priceCents;
      seller.units++;
      seller.orderIds.add(order.id);
      sellerStats.set(item.sellerId, seller);
      const category = categoryStats.get(item.categoryId) || { id: item.categoryId, revenueCents: 0 };
      category.revenueCents += item.priceCents;
      categoryStats.set(item.categoryId, category);
    }
    lines += productSellerPairs.size;
  }
  const repeatBuyers = [...buyerOrders.values()].filter(count => count >= 2).length;
  const sellerInfo = new Map(data.sellers.map(s => [s.id, s]));
  const categoryInfo = new Map(data.categories.map(c => [c.id, c.name]));
  const byRevenue = (a, b) => b.revenueCents - a.revenueCents || String(a.id).localeCompare(String(b.id));
  return {
    meta: { source: data.source, loadedAt: data.loadedAt, currency: 'BRL', filters, period: { start: '2016-09', end: '2018-08' } },
    kpis: {
      revenueCents, averageOrderCents: ordersWithItems ? Math.round(orderTotalCents / ordersWithItems) : null,
      customers: buyerOrders.size, repeatBuyers, repeatPercent: buyerOrders.size ? repeatBuyers / buyerOrders.size * 100 : null,
      deliveredOrders, allOrders: scoped.length,
      averageUnits: ordersWithItems ? units / ordersWithItems : null,
      averageLines: ordersWithItems ? lines / ordersWithItems : null,
    },
    monthly: [...monthly.values()],
    sellers: [...sellerStats.values()].sort(byRevenue).slice(0, 10).map(s => ({
      id: s.id, city: sellerInfo.get(s.id)?.city || 'Не указан', state: sellerInfo.get(s.id)?.state || '—',
      revenueCents: s.revenueCents, units: s.units, orders: s.orderIds.size,
    })),
    categories: [...categoryStats.values()].sort(byRevenue).map(c => ({
      ...c, name: categoryInfo.get(c.id) || c.id || 'Не указана', share: revenueCents ? c.revenueCents / revenueCents * 100 : 0,
    })),
    regions: [...new Set(data.orders.map(o => o.state).filter(Boolean))].sort(),
  };
}
