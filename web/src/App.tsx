import { useEffect, useState } from 'react';
import { MonthlyChart } from './MonthlyChart';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown,
  Database, Info, MapPin, Package, RefreshCw, Repeat2, SearchX, ShieldCheck,
  ShoppingBag, SlidersHorizontal, UsersRound, X, type LucideIcon } from 'lucide-react';
import type { Filters, MonthPoint, Overview } from './types';
import { Dialog, InfoButton } from './ui';
import { ModelPage, OrdersPage, QualityPage } from './pages';
import { decimal, integer, money, monthLabel, periodLabel, shortMoney, states } from './format';

const initialFilters: Filters = { start: '2016-09', end: '2018-08', state: 'all' };
const tabs = [{ id: 'overview', name: 'Обзор', Icon: BarChart3 }, { id: 'orders', name: 'Заказы', Icon: ShoppingBag },
  { id: 'quality', name: 'Проверки', Icon: ShieldCheck }, { id: 'model', name: 'Модель', Icon: Database }];
const pageCopy: Record<string, { title: string; subtitle: string; eyebrow: string }> = {
  overview: { title: 'Обзор аналитики', subtitle: 'Продажи, покупатели и всё, что между ними.', eyebrow: 'МАРКЕТПЛЕЙС · ОБЩАЯ КАРТИНА' },
  orders: { title: 'Заказы', subtitle: 'Каждый заказ — от оформления до вручения.', eyebrow: 'МАРКЕТПЛЕЙС · ДЕТАЛИ ПРОЦЕССА' },
  quality: { title: 'Качество данных', subtitle: 'Проверяем факты, понимаем ограничения.', eyebrow: 'МАРКЕТПЛЕЙС · ДОВЕРИЕ К ДАННЫМ' },
  model: { title: 'Модель данных', subtitle: 'От исходных выгрузок к объяснимой аналитике.', eyebrow: 'МАРКЕТПЛЕЙС · АРХИТЕКТУРА' },
};
function readRoute() {
  const [path, params = ''] = window.location.hash.replace(/^#\/?/, '').split('?');
  return { page: tabs.some(t => t.id === path) ? path : 'overview', orderId: new URLSearchParams(params).get('id') };
}
type Explanation = 'revenue' | 'average' | 'customers' | 'repeat' | 'chart' | 'sellers' | 'categories' | 'source';
const explanations: Record<Explanation, { title: string; lead: string; formula: string; source: string; notes: string[] }> = {
  revenue: { title: 'Товарная выручка', lead: 'Стоимость товаров в доставленных заказах. Доставка в выручку не входит.',
    formula: 'SUM(цена позиции), статус заказа = delivered', source: 'core.orders → core.order_items',
    notes: ['Период определяется датой оформления заказа, а не датой вручения.', 'Учитываются выбранный период и штат покупателя.', 'Платежи не присоединяются к позициям: это защищает сумму от задвоения.'] },
  average: { title: 'Средний чек заказа', lead: 'Средняя стоимость доставленного заказа с учётом доставки.',
    formula: 'SUM(цена товаров + доставка) / число доставленных заказов с позициями', source: 'core.orders → core.order_items',
    notes: ['Сначала собираем сумму каждого заказа, затем считаем среднее.', 'Заказы без позиций не имеют определённого чека и исключаются из знаменателя.', 'Чеки регионов нельзя складывать или усреднять без весов.', 'Единица — одна запись order_items. Товарная строка — уникальная пара товар + продавец внутри заказа; трактовку строк подтверждает аналитик.'] },
  customers: { title: 'Уникальные покупатели', lead: 'Люди, оформившие хотя бы один заказ в выбранном периоде и регионе.',
    formula: 'COUNT(DISTINCT customer_unique_id)', source: 'core.orders → core.customers',
    notes: ['Учитываем все статусы, включая отменённые заказы.', 'customer_id относится к оформлению, а customer_unique_id — к человеку.', 'Один человек может встретиться в нескольких месяцах. Складывать месячные значения нельзя.'] },
  repeat: { title: 'Повторные покупки', lead: 'Доля покупателей с двумя и более заказами внутри выбранного периода и региона.',
    formula: 'Покупатели с ≥ 2 заказами / все покупатели × 100%', source: 'core.orders → core.customers',
    notes: ['Учитываем все статусы. Это повторные оформления, а не только повторные доставки.', 'Два заказа считаются в текущем срезе; покупка до выбранного периода не делает покупателя повторным в этом срезе.', 'Контроль задания 3,12% относится ко всей исходной выгрузке, а не к произвольному фильтру.'] },
  chart: { title: 'Как рассчитана динамика', lead: 'Выручка и число доставленных заказов показаны одновременно по календарным месяцам оформления.',
    formula: 'Выручка = SUM(price) · Заказы = COUNT(DISTINCT order_id)', source: 'core.orders → core.order_items',
    notes: ['Розовая линия и левая шкала — выручка BRL; бирюзовый пунктир и правая шкала — заказы. Высота линий не означает равенства денег и количества.', 'Оба ряда учитывают только delivered. Правило подсчёта заказов — рабочее определение команды.', 'Полный период содержит 24 месяца. Месяцы без заказов остаются с нулём.', 'Нажмите на точку, чтобы посмотреть итог месяца и применить его как фильтр.', 'В деморежиме график и все карточки рассчитаны из одних синтетических заказов.'] },
  sellers: { title: 'Топ-10 продавцов', lead: 'Продавцы с наибольшей товарной выручкой в выбранном срезе.',
    formula: 'SUM(price) по seller_id; только delivered', source: 'core.order_items → core.orders + core.sellers',
    notes: ['Продавцу относится только стоимость его позиций, а не весь чек заказа.', 'Город и штат в таблице относятся к продавцу. Фильтр региона сверху — к покупателю.', 'Один заказ с несколькими продавцами входит в число заказов каждого из них. Эти количества неаддитивны.', 'Топ-10 — часть продавцов, его сумма не обязана равняться выручке площадки.'] },
  categories: { title: 'Выручка по категориям', lead: 'Стоимость доставленных товарных позиций с долей в общей выручке выбранного среза.',
    formula: 'Выручка категории / общая товарная выручка × 100%', source: 'core.order_items → core.products → core.categories',
    notes: ['Нет перевода — показываем исходный код категории. Нет категории — «Не указана».', 'Категории группируются по исходному ключу, а не по отображаемому переводу.', 'Сумма всех категорий, включая «Не указана», равна товарной выручке.', 'Короткий список можно развернуть кнопкой под графиком.'] },
  source: { title: 'Откуда берутся данные', lead: 'Источник подписан в интерфейсе. SQL-снимок — переданные результаты команды, а не выдуманные заказы.',
    formula: 'team-snapshot → результаты SQL команды · core → онлайн-БД · demo → тестовые заказы', source: 'GET /api/overview',
    notes: ['Демоданные созданы для проверки интерфейса. Они не являются результатами Olist и не подгоняются под контрольные числа.', 'В режиме core сервер читает модель команды в транзакции только для чтения. Обновление снимка — раз в минуту.', 'При ошибке core показывается ошибка: автоматической подмены реальных данных демонстрационными нет.'] },
};

function Metric({ label, Icon, value, compact, caption, onInfo }: {
  label: string; Icon: LucideIcon; value: string; compact?: string; caption: string; onInfo: () => void;
}) {
  return <article className="metric-card">
    <div className="metric-top"><span className="metric-label"><Icon size={17} strokeWidth={1.6} aria-hidden="true" />{label}</span><InfoButton label={label} onClick={onInfo} /></div>
    <p className="metric-value" title={value}>{compact ? <><span className="value-full">{value}</span><span className="value-compact">{compact}</span></> : value}</p>
    <p className="metric-caption">{caption}</p>
  </article>;
}

function exportMonthly(data: Overview) {
  const rows = ['month;delivered_orders;revenue_BRL', ...data.monthly.map(p => `${p.month};${p.orders};${(p.revenueCents / 100).toFixed(2)}`)];
  const url = URL.createObjectURL(new Blob(['\uFEFF', rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `capibara-${data.meta.source}-${data.meta.filters.start}-${data.meta.filters.end}-${data.meta.filters.state}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PeriodDialog({ filters, onApply, onClose }: { filters: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters);
  const invalid = !draft.start || !draft.end || draft.start > draft.end || draft.start < '2016-09' || draft.end > '2018-08';
  return <Dialog title="Период анализа" onClose={onClose}>
    <p className="dialog-lead">Фильтр применяется ко всем показателям, продавцам и категориям.</p>
    <div className="period-presets">{[
      ['Весь период', '2016-09', '2018-08'], ['2017 год', '2017-01', '2017-12'], ['2018 год', '2018-01', '2018-08'],
    ].map(([name, start, end]) => <button key={name} type="button" className={`chip ${draft.start === start && draft.end === end ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, start, end })}>{name}</button>)}</div>
    <div className="period-fields"><label>С месяца<input type="month" min="2016-09" max="2018-08" value={draft.start} onChange={e => setDraft({ ...draft, start: e.target.value })} /></label>
      <label>По месяц<input type="month" min="2016-09" max="2018-08" value={draft.end} onChange={e => setDraft({ ...draft, end: e.target.value })} /></label></div>
    <p className="field-hint">{invalid ? 'Укажите корректный период с сентября 2016 по август 2018.' : 'Границы включены. Месяцы без заказов сохраняются.'}</p>
    <button type="button" className="button primary wide" disabled={invalid} onClick={() => { onApply(draft); onClose(); }}>Применить период<ArrowRight size={17} /></button>
  </Dialog>;
}

function Dashboard({ data, showInfo, filters, onMonth }: {
  data: Overview; showInfo: (key: Explanation) => void; filters: Filters; onMonth: (point: MonthPoint) => void;
}) {
  const [allCategories, setAllCategories] = useState(false);
  const [sellerDetail, setSellerDetail] = useState<Overview['sellers'][number] | null>(null);
  const k = data.kpis;
  const categories = allCategories ? data.categories : data.categories.slice(0, 6);
  return <>
    <section className="metrics-grid" aria-label="Ключевые показатели">
      <Metric label="Товарная выручка" Icon={BarChart3} value={money(k.revenueCents)} compact={shortMoney(k.revenueCents)} caption="Без доставки · delivered" onInfo={() => showInfo('revenue')} />
      <Metric label="Средний чек" Icon={ShoppingBag} value={k.averageOrderCents === null ? '—' : money(k.averageOrderCents)} caption="С доставкой · delivered" onInfo={() => showInfo('average')} />
      <Metric label="Покупатели" Icon={UsersRound} value={integer(k.customers)} caption={data.meta.source === 'team-snapshot' ? 'Вся выгрузка · все статусы' : 'Уникальные · все статусы'} onInfo={() => showInfo('customers')} />
      <Metric label="Повторные покупки" Icon={Repeat2} value={k.repeatPercent === null ? '—' : `${decimal(k.repeatPercent)}%`} caption={`${integer(k.repeatBuyers)} покупателей · ${data.meta.source === 'team-snapshot' ? 'вся выгрузка' : 'все статусы'}`} onInfo={() => showInfo('repeat')} />
    </section>

    <MonthlyChart monthly={data.monthly} onInfo={() => showInfo('chart')} onMonth={onMonth} />

    <div className="details-grid">
      <section className="panel seller-panel" aria-labelledby="sellers-title"><div className="panel-heading"><div className="heading-line"><h2 id="sellers-title">Топ-10 продавцов</h2><InfoButton label="Топ-10 продавцов" onClick={() => showInfo('sellers')} /></div><span className="muted panel-subtitle">По товарной выручке</span></div>
        {!data.sellers.length ? <EmptyBlock text="В этом срезе нет доставленных заказов" /> : <>
          <div className="table-scroll seller-table"><table><thead><tr><th>#</th><th>Продавец / город</th><th className="number">Заказы</th><th className="number">Ед.</th><th className="number">Выручка, BRL</th></tr></thead><tbody>{data.sellers.map((s, i) => <tr key={s.id}><td className="rank">{String(i + 1).padStart(2, '0')}</td><td><button type="button" className="seller-link" onClick={() => setSellerDetail(s)} title={s.id}>{s.id.startsWith('demo-') ? `seller_${s.id.slice(-2)}` : `${s.id.slice(0, 10)}…`}<ArrowUpRight size={12} /></button><span className="seller-location">{s.city} / {s.state}</span></td><td className="number">{integer(s.orders)}</td><td className="number">{integer(s.units)}</td><td className="number seller-revenue">{decimal(s.revenueCents / 100)}</td></tr>)}</tbody></table></div>
          <div className="seller-mobile-list">{data.sellers.map((s, i) => <button className="seller-mobile" type="button" key={s.id} onClick={() => setSellerDetail(s)}><span className="rank">{String(i + 1).padStart(2, '0')}</span><span className="seller-mobile-info"><strong>{s.id.startsWith('demo-') ? `seller_${s.id.slice(-2)}` : `${s.id.slice(0, 8)}…`}</strong><small>{s.city} / {s.state}</small></span><span className="seller-mobile-amount"><strong>{money(s.revenueCents)}</strong><small>{integer(s.orders)} заказов · {integer(s.units)} ед.</small></span><ArrowUpRight size={14} /></button>)}</div>
        </>}
        <div className="panel-note"><Info size={13} />Регион в таблице — штат продавца</div>
      </section>
      <section className="panel category-panel" aria-labelledby="categories-title"><div className="panel-heading"><div className="heading-line"><h2 id="categories-title">Выручка по категориям</h2><InfoButton label="Выручка по категориям" onClick={() => showInfo('categories')} /></div><span className="muted panel-subtitle">{data.meta.hasGroupedCategories ? '74 категории · топ-10 и остальные суммарно' : 'Доля в выбранном срезе'}</span></div>
        {!categories.length ? <EmptyBlock text="Продаж по категориям пока нет" /> : <div className="category-list">{categories.map((c, i) => <div className="category-row" key={c.id ?? '__missing'}><div className="category-title"><span className={c.id === null ? 'muted' : ''}>{c.name}</span><strong>{money(c.revenueCents)}</strong></div><div className="category-bar-row"><div className="category-track"><div className="category-fill" style={{ width: `${Math.max(c.share, 0.2)}%`, opacity: 1 - (i % 6) * 0.08 }} /></div><span>{decimal(c.share, 1)}%</span></div></div>)}</div>}
        {data.categories.length > 6 && <button type="button" className="category-more" onClick={() => setAllCategories(!allCategories)} aria-expanded={allCategories}>{allCategories ? 'Свернуть категории' : (data.meta.hasGroupedCategories ? 'Показать топ-10 и остальные' : `Все категории (${data.categories.length})`)}<ChevronDown size={15} className={allCategories ? 'rotated' : ''} /></button>}
        <div className="category-total"><span>Все категории{data.meta.categoryCount ? ` (${data.meta.categoryCount})` : ''}</span><strong>{money(k.revenueCents)}</strong><span>100%</span></div>
      </section>
    </div>
    <section className="order-summary" aria-label="Состав заказа"><Package size={17} /><span>В среднем на доставленный заказ</span><strong>{k.averageLines === null ? '—' : decimal(k.averageLines, data.meta.source === 'team-snapshot' ? 6 : 3)} <small>товарной строки</small></strong><strong>{k.averageUnits === null ? '—' : decimal(k.averageUnits, data.meta.source === 'team-snapshot' ? 6 : 3)} <small>единицы</small></strong><InfoButton label="Строки и единицы в заказе" onClick={() => showInfo('average')} /></section>
    <footer className="page-footer"><span>capibara analytics <span className="footer-dot">·</span> Данные, которые можно объяснить</span><span>{periodLabel(filters.start, filters.end)} · BRL</span></footer>
    {sellerDetail && <Dialog title="Продавец" onClose={() => setSellerDetail(null)}><p className="dialog-lead">{sellerDetail.city}, {sellerDetail.state}</p><label className="id-label">Идентификатор продавца</label><p className="id-value">{sellerDetail.id}</p><dl className="detail-stats"><div><dt>Товарная выручка</dt><dd>{money(sellerDetail.revenueCents)}</dd></div><div><dt>Уникальные заказы</dt><dd>{integer(sellerDetail.orders)}</dd></div><div><dt>Заказанные единицы</dt><dd>{integer(sellerDetail.units)}</dd></div></dl><p className="field-hint">Только доставленные заказы в выбранном периоде и регионе покупателя.</p></Dialog>}
  </>;
}

function EmptyBlock({ text }: { text: string }) { return <div className="empty-block"><SearchX size={24} /><p>{text}</p></div>; }

export default function App() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<MonthPoint | null>(null);
  const [route, setRoute] = useState(readRoute);
  useEffect(() => { const listener = () => setRoute(readRoute()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  useEffect(() => { document.title = `${pageCopy[route.page].title} · Capibara Analytics`; }, [route.page]);
  const copy = pageCopy[route.page];
  const snapshot = data?.meta.source === 'team-snapshot';
  useEffect(() => { if (snapshot && !['overview', 'model'].includes(route.page)) window.location.hash = '/overview'; }, [snapshot, route.page]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/overview?${new URLSearchParams({ ...filters })}`, { signal: abort.signal })
      .then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Не удалось получить данные.'); return body as Overview; })
      .then(setData).catch(err => { if (err.name !== 'AbortError') setError(err.message || 'Сервер недоступен.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [filters, refresh]);
  const filtered = filters.start !== initialFilters.start || filters.end !== initialFilters.end || filters.state !== 'all';
  const navigate = (id: string) => { window.location.hash = `/${id}`; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openOrder = (id: string) => { window.location.hash = `/orders?id=${encodeURIComponent(id)}`; };
  const nav = <>{tabs.map(({ id, name, Icon }) => <button type="button" key={id} className={`nav-tab ${id === route.page ? 'active' : ''}`} aria-current={id === route.page ? 'page' : undefined} disabled={snapshot && !['overview', 'model'].includes(id)} title={snapshot && !['overview', 'model'].includes(id) ? 'Для подробных страниц нужно подключить core' : undefined} onClick={() => navigate(id)}><Icon size={18} strokeWidth={1.65} /><span>{name}</span></button>)}</>;
  return <>
    <a className="skip-link" href="#main">Перейти к аналитике</a>
    <header className="site-header"><div className="header-inner"><a className="wordmark" href="/" aria-label="Capibara Analytics — главная">capibara <span>analytics</span></a><nav className="desktop-nav" aria-label="Разделы">{nav}</nav></div></header>
    <main id="main" className="main-container">
      <div className="page-heading"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.title}</h1><p className="page-subtitle">{copy.subtitle}</p></div><div className="header-actions"><button type="button" className="icon-button refresh" aria-label="Обновить данные" disabled={loading} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={17} className={loading ? 'spinning' : ''} /></button>{route.page === 'overview' && <button type="button" className="button export-button" disabled={!data || loading || !!error} onClick={() => data && exportMonthly(data)}><ArrowDownToLine size={16} /><span>Экспорт CSV</span></button>}</div></div>
      {['overview', 'orders'].includes(route.page) && <div className="filter-row"><button type="button" className="filter-control period-control" disabled={snapshot} title={snapshot ? 'SQL-снимок доступен за весь период' : undefined} onClick={() => setPeriodOpen(true)} aria-label={`Выбрать период: ${periodLabel(filters.start, filters.end)}`}><CalendarDays size={17} /><span>{periodLabel(filters.start, filters.end)}</span><ChevronDown size={15} /></button>
        <label className="filter-control region-control"><MapPin size={17} /><span className="sr-only">Регион покупателя</span><select disabled={snapshot} value={filters.state} onChange={e => setFilters({ ...filters, state: e.target.value })}><option value="all">Все регионы</option>{(data?.regions || []).map(state => <option value={state} key={state}>{states[state] || state} ({state})</option>)}</select><ChevronDown size={15} /></label>
        {filtered && <button type="button" className="reset-filter" onClick={() => setFilters(initialFilters)}><X size={14} />Сбросить</button>}
        <div className="filter-scope"><SlidersHorizontal size={13} /><span>Регион — по покупателю</span></div>
      </div>}
      <div className={`source-strip ${snapshot || data?.meta.source === 'core' ? 'core' : ''}`}><span className="source-label"><i />{snapshot ? 'SQL-результаты команды' : data?.meta.source === 'core' ? 'Данные из core' : data?.meta.source === 'demo' ? 'Демонстрационные данные' : 'Загрузка источника…'}</span><span className="source-description">{snapshot ? 'Сохранённый снимок со скриншотов · 28.10.2026 · без онлайн-подключения к БД' : data?.meta.source === 'core' ? 'Снимок модели команды · обновляется раз в минуту' : data?.meta.source === 'demo' ? 'Тестовые заказы для проверки интерфейса.' : ''}</span><span className="currency-note">Валюта: бразильский реал (BRL)</span><button type="button" className="source-info" aria-label="Об источнике данных" onClick={() => setExplanation('source')}><Info size={15} /></button></div>
      {snapshot && <div className="snapshot-note"><Check size={15} /><span>Контроли сверены: 24 месяца, 13 221 498,11 выручки, средний чек 159,88, 96 096 покупателей. Фильтры недоступны для сохранённого SQL-снимка.</span></div>}
      <div className="status-region" role="status" aria-live="polite">{loading ? 'Загрузка аналитики…' : snapshot ? 'Показаны SQL-результаты команды. Контрольные суммы сверены.' : error ? '' : `Обновлено. ${integer(data?.kpis.allOrders || 0)} заказов в выбранном срезе.`}</div>
      {route.page === 'orders' ? <OrdersPage filters={filters} revision={refresh} orderId={route.orderId} openOrder={openOrder} closeOrder={() => { window.location.hash = '/orders'; }} /> : route.page === 'quality' ? <QualityPage revision={refresh} /> : route.page === 'model' ? <ModelPage revision={refresh} /> : error ? <section className="error-panel"><div className="error-symbol"><Database size={25} /></div><h2>Не получилось загрузить аналитику</h2><p>{error}</p><button type="button" className="button primary" onClick={() => setRefresh(n => n + 1)}><RefreshCw size={16} />Повторить</button></section> : !data ? <div className="loading-layout" aria-hidden="true"><div className="metrics-grid">{[0, 1, 2, 3].map(i => <div className="skeleton metric-card" key={i} />)}</div><div className="skeleton chart-skeleton" /></div> : <div className={`dashboard-content ${loading ? 'updating' : ''}`} aria-busy={loading} inert={loading ? true : undefined}>
        {data.kpis.allOrders === 0 && <div className="empty-notice"><SearchX size={18} /><span>За выбранный период заказов нет. Попробуйте другой месяц или регион.</span><button type="button" onClick={() => setFilters(initialFilters)}>Сбросить фильтры</button></div>}
        <Dashboard data={data} showInfo={setExplanation} filters={filters} onMonth={setSelectedMonth} />
      </div>}
    </main>
    <nav className="mobile-nav" aria-label="Мобильные разделы">{nav}</nav>
    {periodOpen && <PeriodDialog filters={filters} onApply={setFilters} onClose={() => setPeriodOpen(false)} />}
    {explanation && <Dialog title={explanations[explanation].title} onClose={() => setExplanation(null)}><p className="dialog-lead">{explanations[explanation].lead}</p><div className="formula-box"><span>Формула</span><p>{explanations[explanation].formula}</p></div><ul className="explanation-list">{explanations[explanation].notes.map(note => <li key={note}><Check size={15} /><span>{note}</span></li>)}</ul><div className="data-origin"><Database size={15} /><span>{explanations[explanation].source}</span></div></Dialog>}
    {selectedMonth && <Dialog title={monthLabel(selectedMonth.month, true)} onClose={() => setSelectedMonth(null)}><p className="dialog-lead">Результат SQL по доставленным заказам за месяц.</p><dl className="detail-stats"><div><dt>Товарная выручка</dt><dd>{money(selectedMonth.revenueCents)}</dd></div><div><dt>Доставленные заказы</dt><dd>{integer(selectedMonth.orders)}</dd></div></dl>{snapshot ? <p className="field-hint">Сохранённый результат команды. Для пересчёта остальных показателей за этот месяц и просмотра заказов нужно подключить core.</p> : <button type="button" className="button primary wide" onClick={() => { setFilters({ ...filters, start: selectedMonth.month, end: selectedMonth.month }); setSelectedMonth(null); }}>Посмотреть этот месяц<ArrowRight size={16} /></button>}</Dialog>}
  </>;
}
