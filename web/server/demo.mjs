// Explicitly synthetic, deterministic data. Money is stored in centavos.
export const categories = [
  { id: 'casa', name: 'Дом и интерьер' },
  { id: 'beleza', name: 'Красота и здоровье' },
  { id: 'esporte', name: 'Спорт и отдых' },
  { id: 'informatica', name: 'Электроника' },
  { id: 'moda', name: 'Одежда и аксессуары' },
  { id: 'brinquedos', name: 'Детские товары' },
  { id: 'livros', name: 'Книги' },
  { id: null, name: 'Не указана' },
];
export const sellers = [
  ['SP', 'São Paulo'], ['RJ', 'Rio de Janeiro'], ['MG', 'Belo Horizonte'],
  ['PR', 'Curitiba'], ['SP', 'Campinas'], ['RS', 'Porto Alegre'],
  ['SC', 'Florianópolis'], ['BA', 'Salvador'], ['PE', 'Recife'],
  ['SP', 'Santos'], ['MG', 'Uberlândia'], ['PR', 'Londrina'],
].map(([state, city], i) => ({ id: `demo-seller-${String(i + 1).padStart(2, '0')}`, state, city }));

export function monthRange(start = '2016-09', end = '2018-08') {
  const result = [];
  let [year, month] = start.split('-').map(Number);
  while (`${year}-${String(month).padStart(2, '0')}` <= end) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    if (++month === 13) { year++; month = 1; }
  }
  return result;
}

export function makeDemoData() {
  let seed = 271828;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const states = ['SP', 'RJ', 'MG', 'PR', 'RS', 'SC', 'BA', 'PE'];
  const orders = [];
  let sequence = 0;
  for (const [index, month] of monthRange().entries()) {
    if (month === '2016-11') continue;
    const count = Math.round((42 + index * 24) * (0.82 + random() * 0.36));
    for (let j = 0; j < count; j++) {
      sequence++;
      const delivered = random() > 0.055;
      const order = {
        id: `demo-order-${String(sequence).padStart(5, '0')}`,
        purchasedAt: `${month}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
        status: delivered ? 'delivered' : random() < 0.55 ? 'canceled' : 'shipped',
        buyerId: random() < 0.075 && sequence > 20 ? `demo-buyer-${Math.floor(random() * (sequence - 1)) + 1}` : `demo-buyer-${sequence}`,
        state: states[Math.floor(random() * states.length)],
        items: [],
      };
      const units = random() < 0.16 ? 2 + Math.floor(random() * 2) : 1;
      for (let k = 0; k < units; k++) {
        const category = categories[Math.floor(random() * categories.length)];
        const seller = sellers[Math.floor(random() ** 1.7 * sellers.length)];
        order.items.push({
          productId: `demo-product-${category.id || 'unknown'}-${Math.floor(random() * 30)}`,
          sellerId: seller.id, categoryId: category.id,
          priceCents: 1590 + Math.floor(random() ** 2 * 39900),
          freightCents: 650 + Math.floor(random() * 2250),
        });
      }
      orders.push(order);
    }
  }
  // Detail-only enrichment does not change the seeded prices or overview totals.
  const addDays = (day, days) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 19);
  const cities = { SP: 'São Paulo', RJ: 'Rio de Janeiro', MG: 'Belo Horizonte', PR: 'Curitiba', RS: 'Porto Alegre', SC: 'Florianópolis', BA: 'Salvador', PE: 'Recife' };
  for (const [idx, o] of orders.entries()) {
    o.customerId = `demo-customer-${idx + 1}`;
    o.city = cities[o.state];
    o.approvedAt = o.status === 'canceled' ? null : addDays(o.purchasedAt, 0);
    o.carrierAt = ['delivered', 'shipped'].includes(o.status) ? addDays(o.purchasedAt, 2) : null;
    o.deliveredAt = o.status === 'delivered' && idx % 113 !== 0 ? addDays(o.purchasedAt, idx % 7 === 0 ? 22 : 7 + idx % 6) : null;
    o.estimatedAt = addDays(o.purchasedAt, 16).slice(0, 10);
    o.items.forEach((item, i) => { item.itemId = i + 1; item.shippingLimitAt = addDays(o.purchasedAt, 3); });
    const total = o.items.reduce((sum, i) => sum + i.priceCents + i.freightCents, 0);
    const amount = total + (idx % 79 === 0 ? 125 : 0);
    o.payments = idx % 131 === 0 || o.status === 'canceled' ? [] : idx % 5 === 0 ? [
      { sequential: 1, type: 'credit_card', installments: 3, valueCents: amount - 1000 },
      { sequential: 2, type: 'voucher', installments: 1, valueCents: 1000 },
    ] : [{ sequential: 1, type: 'credit_card', installments: 1 + idx % 6, valueCents: amount }];
    o.reviews = o.status === 'delivered' && idx % 3 !== 0 ? [{ id: `demo-review-${idx + 1}`, score: 1 + idx % 5, title: null,
      message: idx % 4 === 0 ? 'Демонстрационный отзыв: заказ получен.' : null,
      createdAt: addDays(o.purchasedAt, 24), answeredAt: addDays(o.purchasedAt, 25) }] : [];
  }
  const products = [...new Map(orders.flatMap(o => o.items.map(i => [i.productId, { id: i.productId, categoryId: i.categoryId }]))).values()];
  return { orders, sellers, categories, products, loadedAt: new Date().toISOString(), source: 'demo' };
}
