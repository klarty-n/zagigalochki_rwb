// Transcribed from the team's SQL result screenshots supplied by the user.
// These are query results, not generated orders and not a live database connection.
// The screenshots show all 24 months and all 10 sellers, but not all 74 categories.
const monthlyRows = [
  ['2016-09',1,13497], ['2016-10',265,4032511], ['2016-11',0,0], ['2016-12',1,1090],
  ['2017-01',750,11179836], ['2017-02',1653,23422340], ['2017-03',2546,35919885], ['2017-04',2303,34066968],
  ['2017-05',3546,48933825], ['2017-06',3135,42192337], ['2017-07',3872,48160452], ['2017-08',4193,55469970],
  ['2017-09',4150,60739967], ['2017-10',4478,64824765], ['2017-11',7289,98776537], ['2017-12',5513,72603319],
  ['2018-01',7069,92464500], ['2018-02',6555,82643713], ['2018-03',7003,95335625], ['2018-04',6798,97353409],
  ['2018-05',6749,97754469], ['2018-06',6099,85607786], ['2018-07',6159,86795346], ['2018-08',6351,83857664],
];
const sellerRows = [
  ['4869f7a5dfa277a7dca6462dcf3b52b2','guariba','SP',1124,1148,22698793],
  ['53243585a1d6dc2643021fd1853d8905','lauro de freitas','BA',348,400,21794044],
  ['4a3ca9315b744ce9f8e9374361493884','ibitinga','SP',1772,1949,19688212],
  ['fa1c13f2614d7b5c4749cbc52fecda94','sumare','SP',578,579,19091714],
  ['7c67e1448b00f6e969d365cea6b010ab','itaquaquecetuba','SP',973,1355,18657005],
  ['7e93a43ef30c4f03f38b393420bc753a','barueri','SP',319,322,16598149],
  ['da8622b14eb17ae2831f4ac5b9dab84a','piracicaba','SP',1311,1548,15981687],
  ['7a67c85e85bb2ce8582c35f2203ad736','sao paulo','SP',1145,1155,13965869],
  ['1025f0e2d44d7041d6cf58b6550e0bfa','sao paulo','SP',910,1420,13820856],
  ['955fee9216a65b617aa5c0531780ce60','sao paulo','SP',1261,1472,13183671],
];
const categoryRows = [
  ['health_beauty',123313172], ['watches_gifts',116617698], ['bed_bath_table',102343476],
  ['sports_leisure',95485255], ['computers_accessories',88872461], ['furniture_decor',71192769],
  ['housewares',61562869], ['cool_stuff',61020410], ['auto',57896665], ['toys',47128648],
];
export const teamSnapshot = {
  meta: { source: 'team-snapshot', loadedAt: '2026-10-28T00:00:00.000Z', currency: 'BRL',
    filters: { start: '2016-09', end: '2018-08', state: 'all' }, period: { start: '2016-09', end: '2018-08' },
    filtering: false, categoryCount: 74, hasGroupedCategories: true,
    provenance: 'Результаты SQL команды, переданные скриншотами 28.10.2026. Не онлайн-подключение к PostgreSQL.',
    scopes: { sales: 'Доставленные заказы, сентябрь 2016 — август 2018', customers: 'Вся выгрузка, все статусы', average: 'Доставленные заказы с позициями, с доставкой' } },
  kpis: { revenueCents: 1322149811, averageOrderCents: 15988, customers: 96096, repeatBuyers: 2997, repeatPercent: 3.12,
    deliveredOrders: 96478, allOrders: null, averageLines: 1.038537, averageUnits: 1.142198 },
  monthly: monthlyRows.map(([month, orders, revenueCents]) => ({ month, orders, revenueCents })),
  sellers: sellerRows.map(([id, city, state, orders, units, revenueCents]) => ({ id, city, state, orders, units, revenueCents })),
  categories: [...categoryRows.map(([id, revenueCents]) => ({ id, name: id, revenueCents, share: revenueCents / 1322149811 * 100 })),
    { id: '__remaining_64', name: 'Остальные 64 категории (суммарно)', revenueCents: 1322149811 - categoryRows.reduce((s, r) => s + r[1], 0),
      share: (1322149811 - categoryRows.reduce((s, r) => s + r[1], 0)) / 1322149811 * 100 }],
  regions: [],
};

export function verifyTeamSnapshot() {
  const checks = [
    ['24 календарных месяца', teamSnapshot.monthly.length === 24],
    ['Ноябрь 2016 — ноль', teamSnapshot.monthly.find(p => p.month === '2016-11')?.revenueCents === 0],
    ['Выручка месяцев = 13 221 498,11', teamSnapshot.monthly.reduce((s, p) => s + p.revenueCents, 0) === 1322149811],
    ['Доставленные заказы = 96 478', teamSnapshot.monthly.reduce((s, p) => s + p.orders, 0) === 96478],
    ['Лидер продавцов = 226 987,93', teamSnapshot.sellers[0].revenueCents === 22698793],
    ['Средний чек = 159,88', teamSnapshot.kpis.averageOrderCents === 15988],
    ['Покупатели = 96 096; повторные = 2 997', teamSnapshot.kpis.customers === 96096 && teamSnapshot.kpis.repeatBuyers === 2997],
    ['Доля повторных после округления = 3,12%', Number((2997 / 96096 * 100).toFixed(2)) === 3.12],
    ['Категории с остатком = общая выручка', teamSnapshot.categories.reduce((s, c) => s + c.revenueCents, 0) === 1322149811],
    ['Лидер категорий = 1 233 131,72', teamSnapshot.categories[0].revenueCents === 123313172],
  ];
  if (checks.some(([, ok]) => !ok)) throw new Error(`Нарушена сверка снимка: ${checks.filter(([, ok]) => !ok).map(([name]) => name).join(', ')}`);
  return checks.map(([name, passed]) => ({ name, passed }));
}
verifyTeamSnapshot();
