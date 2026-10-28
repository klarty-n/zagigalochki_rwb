import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Boxes, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, CreditCard,
  Database, FileText, GitBranch, Info, KeyRound, Layers3, Minus, Package, Plus, Search, SearchX, ShieldCheck, Star, Truck, X } from 'lucide-react';
import type { Filters } from './types';
import { integer, money, states } from './format';
import { ApiFeedback, dateTime, Dialog, useApi } from './ui';

interface Meta { source: 'demo' | 'core'; loadedAt: string }
interface OrderRow { id: string; purchasedAt: string; status: string; city: string | null; state: string; units: number; sellers: number; productCents: number; freightCents: number; totalCents: number | null; deliveredAt: string | null; estimatedAt: string | null }
interface OrdersResponse { meta: Meta; total: number; page: number; pages: number; pageSize: number; statusCounts: Record<string, number>; items: OrderRow[] }
interface OrderDetail {
  meta: Meta; order: OrderRow & { buyerId: string; customerId: string | null; paidCents: number | null; paymentDifferenceCents: number | null };
  items: { itemId: number; productId: string; sellerId: string; category: string; priceCents: number; freightCents: number; shippingLimitAt: string | null; seller: { city: string; state: string } | null }[];
  payments: { sequential: number; type: string; installments: number; valueCents: number }[];
  reviews: { id: string; score: number; title: string | null; message: string | null; createdAt: string | null; answeredAt: string | null }[];
  events: { key: string; label: string; at: string | null }[];
}
const statusLabels: Record<string, string> = { delivered: 'Доставлен', shipped: 'В пути', canceled: 'Отменён', unavailable: 'Недоступен', invoiced: 'Выставлен счёт', processing: 'В обработке', created: 'Создан', approved: 'Подтверждён' };
const paymentLabels: Record<string, string> = { credit_card: 'Кредитная карта', debit_card: 'Дебетовая карта', voucher: 'Ваучер', boleto: 'Банковский платёж', not_defined: 'Не определён' };
function Status({ status }: { status: string }) { return <span className={`status-pill status-${status}`}><i />{statusLabels[status] || status}</span>; }
function SourceNote({ meta }: { meta: Meta }) { return <span className="section-source">{meta.source === 'demo' ? 'Демонстрационный снимок' : 'Данные заказов'} · {dateTime(meta.loadedAt)}</span>; }

export function OrderModal({ id, onClose }: { id: string; onClose: () => void }) {
  const request = useApi<OrderDetail>(`/api/orders/${encodeURIComponent(id)}`);
  const d = request.data;
  const late = d?.order.deliveredAt && d.order.estimatedAt && d.order.deliveredAt.slice(0, 10) > d.order.estimatedAt;
  return <Dialog title="Карточка заказа" wide onClose={onClose}>
    <ApiFeedback loading={request.loading} error={request.error} retry={request.retry} />
    {!request.loading && !request.error && d && <>
      <div className="order-detail-heading"><code>{d.order.id}</code><Status status={d.order.status} /></div>
      <div className="detail-location"><Truck size={16} /><span>{d.order.city || 'Город не указан'} · {states[d.order.state] || d.order.state} ({d.order.state})</span></div>
      <div className="detail-money-grid"><div><span>Товары</span><strong>{money(d.order.productCents)}</strong></div><div><span>Доставка</span><strong>{money(d.order.freightCents)}</strong></div><div><span>Чек заказа · BRL</span><strong>{d.order.totalCents === null ? '—' : money(d.order.totalCents)}</strong></div></div>
      <section className="detail-section"><h3>Путь заказа</h3><p className="section-description">Только события, даты которых присутствуют в источнике.</p><ol className="order-timeline">{d.events.map((e, i) => <li key={e.key} className={e.at ? 'event-present' : ''}><span className="event-mark">{e.at ? <Check size={14} /> : <Clock3 size={14} />}</span><div><strong>{e.label}</strong><span>{e.at ? dateTime(e.at) : 'Дата отсутствует'}</span></div><small>0{i + 1}</small></li>)}</ol><div className={`estimated-date ${late ? 'is-late' : ''}`}><CalendarIcon /><span>Обещанная доставка: <strong>{dateTime(d.order.estimatedAt, false)}</strong>{late && ' · Доставлен позже срока'}</span></div></section>
      <section className="detail-section"><h3>Товарные позиции <span className="count-badge">{d.items.length}</span></h3><p className="section-description">Одна строка — одна заказанная единица. Названий товаров в исходнике нет, показаны ID и категории.</p>
        {d.items.length ? <div className="item-detail-list">{d.items.map(i => <article key={i.itemId}><div className="item-number"><Package size={17} /><span>Позиция {i.itemId}</span></div><div className="item-details"><strong>{i.category}</strong><code title={i.productId}>{i.productId}</code><span>Продавец: <code>{i.sellerId}</code></span><small>{i.seller?.city || 'Город не указан'} / {i.seller?.state || '—'} · Срок отгрузки: {dateTime(i.shippingLimitAt, false)}</small></div><div className="item-price"><strong>{money(i.priceCents)}</strong><span>+ {money(i.freightCents)} доставка</span></div></article>)}</div> : <div className="inline-empty">У заказа нет позиций.</div>}
      </section>
      <section className="detail-section"><h3>Оплата <span className="count-badge">{d.payments.length}</span></h3>
        {d.payments.length ? <div className="payment-list">{d.payments.map(p => <div key={p.sequential}><CreditCard size={17} /><span>{paymentLabels[p.type] || p.type}<small>Запись {p.sequential} · частей рассрочки: {p.installments}</small></span><strong>{money(p.valueCents)}</strong></div>)}</div> : <div className="inline-empty">Записи оплаты отсутствуют. Оплаченная сумма неизвестна.</div>}
        <dl className="payment-reconciliation"><div><dt>Оплачено, BRL</dt><dd>{d.order.paidCents === null ? '—' : money(d.order.paidCents)}</dd></div><div className={d.order.paymentDifferenceCents ? 'difference' : ''}><dt>Оплата − чек</dt><dd>{d.order.paymentDifferenceCents === null ? 'Не определено' : money(d.order.paymentDifferenceCents)}</dd></div></dl>
        <p className="section-description">Сумма оплаты включает все платежи по заказу.</p>
      </section>
      <section className="detail-section"><h3>Отзывы <span className="count-badge">{d.reviews.length}</span></h3>{d.reviews.length ? <div className="review-list">{d.reviews.map(r => <article key={r.id}><div className="review-score"><Star size={16} />{r.score} / 5<span>{dateTime(r.createdAt)}</span></div>{r.title && <strong>{r.title}</strong>}<p>{r.message || 'Текст отзыва отсутствует.'}</p></article>)}</div> : <div className="inline-empty">Покупатель не оставил отзыв.</div>}</section>
      <details className="technical-details"><summary>Идентификаторы покупателя</summary><dl><dt>ID оформления</dt><dd>{d.order.customerId || 'Не указан'}</dd><dt>Идентификатор покупателя</dt><dd>{d.order.buyerId}</dd></dl></details>
      <SourceNote meta={d.meta} />
    </>}
  </Dialog>;
}
function CalendarIcon() { return <Clock3 size={16} />; }

export function OrdersPage({ filters, revision, orderId, openOrder, closeOrder }: { filters: Filters; revision: number; orderId: string | null; openOrder: (id: string) => void; closeOrder: () => void }) {
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [sort, setSort] = useState('date_desc'), [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => setPage(1), [filters]);
  const request = useApi<OrdersResponse>(`/api/orders?${new URLSearchParams({ ...filters, q: query, status, sort, page: String(page), pageSize: '20' })}`, revision);
  const d = request.data;
  return <>
    <section className="panel orders-panel"><div className="orders-toolbar"><label className="search-field"><Search size={17} /><span className="sr-only">Поиск по ID заказа</span><input value={search} maxLength={128} placeholder="Найти заказ по ID" onChange={e => setSearch(e.target.value)} />{search && <button type="button" className="icon-button" aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={15} /></button>}</label>
      <label className="compact-select"><span className="sr-only">Статус заказа</span><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={14} /></label>
      <label className="compact-select"><span className="sr-only">Сортировка заказов</span><select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option><option value="amount_desc">По сумме чека</option></select><ChevronDown size={14} /></label></div>
      <div className="orders-result-meta"><span role="status">{request.loading ? 'Обновляем список…' : d ? `Найдено ${integer(d.total)} заказов` : ''}</span><span>Суммы с доставкой · BRL</span></div>
      <ApiFeedback loading={request.loading && !d} error={request.error} retry={request.retry} />
      {d && !request.error && <div className={request.loading ? 'updating' : ''} aria-busy={request.loading}>
        {!d.items.length ? <div className="page-feedback"><SearchX size={28} /><h3>Заказов не найдено</h3><p>Измените ID, статус, период или регион.</p><button type="button" className="button" onClick={() => { setSearch(''); setStatus('all'); }}>Очистить поиск и статус</button></div> : <>
          <div className="orders-desktop table-scroll"><table><thead><tr><th>Заказ / дата</th><th>Регион покупателя</th><th>Статус</th><th className="number">Единицы</th><th className="number">Чек, BRL</th><th /></tr></thead><tbody>{d.items.map(o => <tr key={o.id}><td><button type="button" className="order-id-link" title={o.id} onClick={() => openOrder(o.id)}>{o.id.startsWith('demo-') ? o.id : `${o.id.slice(0, 14)}…`}</button><span className="row-secondary">{dateTime(o.purchasedAt, false)}</span></td><td>{o.city || states[o.state] || 'Не указан'}<span className="row-secondary">{o.state} · {o.sellers} продавцов</span></td><td><Status status={o.status} /></td><td className="number">{o.units}</td><td className="number order-total">{o.totalCents === null ? '—' : money(o.totalCents)}</td><td><button type="button" className="icon-button" aria-label={`Открыть заказ ${o.id}`} onClick={() => openOrder(o.id)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>
          <div className="orders-mobile">{d.items.map(o => <button type="button" className="order-mobile-card" key={o.id} onClick={() => openOrder(o.id)}><div><strong>{o.id.startsWith('demo-') ? o.id : `${o.id.slice(0, 12)}…`}</strong><Status status={o.status} /></div><span>{dateTime(o.purchasedAt, false)} · {o.city || states[o.state] || o.state}</span><div><small>{o.units} ед. · {o.sellers} продавцов</small><strong>{o.totalCents === null ? '—' : money(o.totalCents)}<ArrowUpRight size={14} /></strong></div></button>)}</div>
        </>}
        <div className="pagination"><span>{d.total ? `${(d.page - 1) * d.pageSize + 1}–${Math.min(d.page * d.pageSize, d.total)} из ${integer(d.total)}` : 'Нет результатов'}</span><div><button type="button" className="icon-button" aria-label="Предыдущая страница" disabled={d.page <= 1 || request.loading} onClick={() => setPage(d.page - 1)}><ChevronLeft size={18} /></button><span>{d.page} / {d.pages}</span><button type="button" className="icon-button" aria-label="Следующая страница" disabled={d.page >= d.pages || request.loading} onClick={() => setPage(d.page + 1)}><ChevronRight size={18} /></button></div></div>
      </div>}
    </section>
    {d && <div className="section-footnote"><Info size={14} /><span>Даты событий отображаются при наличии в источнике.</span><SourceNote meta={d.meta} /></div>}
    {orderId && <OrderModal id={orderId} onClose={closeOrder} />}
  </>;
}

type CheckStatus = 'pass' | 'warn' | 'fail' | 'not-run';
interface QualityCheck { id: string; name: string; description: string; affected: number | null; status: CheckStatus; samples: string[]; unit: string }
interface QualityResponse { meta: Meta; checkedAt: string; orderCount: number; checks: QualityCheck[]; summary: { pass: number; warn: number; fail: number; notRun: number } }
const checkLabels: Record<CheckStatus, string> = { pass: 'Пройдено', warn: 'Наблюдение', fail: 'Ошибка', 'not-run': 'Не выполнялась' };
export function QualityPage({ revision }: { revision: number }) {
  const request = useApi<QualityResponse>('/api/quality', revision);
  const [filter, setFilter] = useState('all'), [expanded, setExpanded] = useState<string | null>(null);
  const d = request.data;
  return <>
    <ApiFeedback loading={request.loading && !d} error={request.error} retry={request.retry} />
    {d && !request.error && <div className={request.loading ? 'updating' : ''} aria-busy={request.loading}>
      <div className="quality-summary">{[
        { status: 'pass', value: d.summary.pass, label: 'Пройдено', note: 'Без замечаний в снимке' },
        { status: 'warn', value: d.summary.warn, label: 'Наблюдения', note: 'Требуют интерпретации' },
        { status: 'fail', value: d.summary.fail, label: 'Ошибки', note: 'Нарушены правила' },
        { status: 'not-run', value: d.summary.notRun, label: 'Не выполнялись', note: 'Нет подтверждения' },
      ].map(s => <button type="button" className={`panel quality-stat ${s.status} ${filter === s.status ? 'chosen' : ''}`} key={s.status} onClick={() => setFilter(filter === s.status ? 'all' : s.status)} aria-pressed={filter === s.status}><span>{s.label}</span><strong>{s.value}</strong><small>{s.note}</small></button>)}</div>
      <div className="quality-context"><ShieldCheck size={20} /><div><strong>Проверки текущего снимка</strong><p>Весь набор: {integer(d.orderCount)} заказов. {dateTime(d.checkedAt)}. Фильтры периода и региона к этой странице не применяются.</p></div></div>
      <section className="panel checks-panel"><div className="checks-toolbar"><h2>Правила и результаты</h2><label className="compact-select"><span className="sr-only">Фильтр результатов проверок</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Все проверки</option>{Object.entries(checkLabels).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</select><ChevronDown size={14} /></label></div>
        {d.checks.filter(c => filter === 'all' || c.status === filter).map(c => <article className="quality-check" key={c.id}><button type="button" className="check-toggle" aria-expanded={expanded === c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)}><span className={`check-symbol ${c.status}`}>{c.status === 'pass' ? <Check size={17} /> : c.status === 'not-run' ? <Clock3 size={17} /> : <Info size={17} />}</span><span className="check-name"><strong>{c.name}</strong><small>{c.affected === null ? 'Проверка загрузки выполняется отдельно' : c.affected ? `${integer(c.affected)} ${c.unit}` : 'Нарушений не найдено'}</small></span><span className={`check-result ${c.status}`}>{checkLabels[c.status]}</span><ChevronDown size={16} className={expanded === c.id ? 'rotated' : ''} /></button>
          {expanded === c.id && <div className="check-details"><p>{c.description}</p>{c.samples.length > 0 && <div className="check-samples"><span>Примеры заказов</span>{c.samples.map(id => <a href={`#/orders?id=${encodeURIComponent(id)}`} key={id}>{id}<ArrowUpRight size={13} /></a>)}</div>}</div>}</article>)}
        {!d.checks.some(c => filter === 'all' || c.status === filter) && <div className="page-feedback"><Check size={26} /><p>Проверок с таким результатом нет.</p></div>}
      </section>
      <div className="section-footnote"><Info size={14} /><span>Результаты проверок отражают состояние данных на момент обновления.</span></div><SourceNote meta={d.meta} />
    </div>}
  </>;
}

interface ModelField { name: string; type: string; role: string; nullable: boolean }
interface ModelEntity { inputs?: string[]; id: string; raw: string; title: string; grain: string; key: string; note: string; fields: ModelField[]; count: number | null }
interface ModelRelation { from: string; to: string; label: string; cardinality: string; note?: string }
interface ModelResponse { source: 'demo' | 'core' | 'mart' | 'team-snapshot'; available: boolean; loadedAt: string | null; contract: string; entities: ModelEntity[]; relations: ModelRelation[]; marts: ModelEntity[]; martRelations: ModelRelation[]; martAvailable: boolean }
export function ModelPage({ revision }: { revision: number }) {
  const request = useApi<ModelResponse>('/api/model', revision);
  const [selected, setSelected] = useState('orders'), [stage, setStage] = useState<'core' | 'raw' | 'mart'>('core');
  const [query, setQuery] = useState(''), [zoom, setZoom] = useState(1), [view, setView] = useState<'schema' | 'relations'>('schema');
  const d = request.data;
  const entity = (stage === 'mart' ? d?.marts : d?.entities)?.find(e => e.id === selected);
  const matches = (e: ModelEntity) => `${e.id} ${e.raw} ${e.title}`.toLowerCase().includes(query.toLowerCase());
  const select = (name: string) => {
    const [schema,id] = name.includes('.') ? name.split('.') : ['core',name];
    setStage(schema === 'mart' ? 'mart' : 'core'); setSelected(id);
  };
  const links = d ? [...d.relations.map(r => ({...r,from:`core.${r.from}`,to:`core.${r.to}`})),...d.martRelations] : [];
  const fullName = `${stage}.${selected}`;
  return <>
    <ApiFeedback loading={request.loading && !d} error={request.error} retry={request.retry} />
    {d && !request.error && <>
      <div className="model-principles"><div><Database size={18} /><strong>raw</strong><span>Исходные данные</span></div><ArrowRight size={18} /><div><Boxes size={18} /><strong>core</strong><span>Заказы, товары и покупатели</span></div><ArrowRight size={18} /><div><BarIcon /><strong>mart</strong><span>Витрины для аналитики</span></div></div>
      <div className="model-caption"><span><FileText size={14} />{d.contract}</span><span>{d.available ? 'Статистика из базы данных' : 'Структура данных · без статистики таблиц'}</span></div>
      <div className="model-layout"><section className="panel schema-panel">
        <div className="schema-toolbar"><div className="chart-switch"><button type="button" aria-pressed={view==='schema'} onClick={() => setView('schema')}>Таблицы и витрины</button><button type="button" aria-pressed={view==='relations'} onClick={() => setView('relations')}>Связи</button></div>
          <div className="zoom-controls"><button type="button" className="icon-button" aria-label="Уменьшить схему" disabled={zoom<=.8} onClick={() => setZoom(z=>Math.max(.8,+(z-.1).toFixed(1)))}><Minus size={16}/></button><button type="button" className="zoom-reset" onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button><button type="button" className="icon-button" aria-label="Увеличить схему" disabled={zoom>=1.3} onClick={()=>setZoom(z=>Math.min(1.3,+(z+.1).toFixed(1)))}><Plus size={16}/></button></div>
        </div>
        <label className="search-field model-search"><Search size={16}/><span className="sr-only">Поиск таблицы или витрины</span><input placeholder="Найти таблицу или витрину…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        {view==='schema' ? <div className="schema-scroll"><div className="schema-board schema-three-layers" style={{width:`${100*zoom}%`,minWidth:`${600*zoom}px`,fontSize:`${13*zoom}px`}}>
          <div className="schema-column"><h3>raw<small>Исходные записи</small></h3>{d.entities.filter(e=>e.raw&&matches(e)).map(e=><button type="button" className={`schema-node raw-node ${stage==='raw'&&selected===e.id?'selected':''}`} key={e.id} onClick={()=>{setStage('raw');setSelected(e.id);}}><Database size={16}/><span><strong>{e.raw}</strong><small>{e.title}</small></span><ArrowRight size={14}/></button>)}</div>
          <div className="schema-gutter"><ArrowRight size={20}/><span>Типы<br/>и связи</span></div>
          <div className="schema-column"><h3>core<small>Единая модель</small></h3>{d.entities.filter(matches).map(e=><button type="button" className={`schema-node ${stage==='core'&&selected===e.id?'selected':''}`} key={e.id} onClick={()=>select(`core.${e.id}`)}><Layers3 size={16}/><span><strong>{e.id}</strong><small>{e.count===null?'Статистика недоступна':`${integer(e.count)} строк`}</small></span><KeyRound size={13}/></button>)}</div>
          <div className="schema-gutter"><ArrowRight size={20}/><span>Расчёты<br/>и срезы</span></div>
          <div className="schema-column"><h3>mart<small>Аналитические витрины · VIEW</small></h3>{d.marts.filter(matches).map(e=><button type="button" className={`schema-node mart-node ${stage==='mart'&&selected===e.id?'selected':''}`} key={e.id} onClick={()=>select(`mart.${e.id}`)}><BarIcon/><span><strong>{e.id}</strong><small>{e.count===null?e.title:`${integer(e.count)} строк`}</small></span></button>)}</div>
        </div>{![...d.entities,...d.marts].some(matches)&&<div className="inline-empty">Таблица или витрина не найдена.</div>}</div> : <div className="relations-list">{links.filter(r=>`${r.from} ${r.to} ${r.label}`.toLowerCase().includes(query.toLowerCase())).map(r=><button type="button" key={`${r.from}-${r.to}`} onClick={()=>select(r.to)}><span><strong>{r.from}</strong><ArrowRight size={15}/><strong>{r.to}</strong></span><small>{r.label}</small><em>{r.cardinality}</em></button>)}</div>}
        <div className="panel-note"><Info size={14}/>Ключи core и SQL-зависимости витрин mart</div>
      </section>
      {entity&&<aside className="panel entity-panel" aria-label="Описание выбранного объекта"><div className="entity-heading"><span className="entity-stage">{stage}{stage==='mart'?' · VIEW':''}</span><h2>{stage==='raw'?entity.raw:entity.id}</h2><p>{entity.title}</p></div>
        <div className="entity-body"><h3>Одна строка</h3><p>{entity.grain}</p><h3>{stage==='mart'?'Уровень уникальности':stage==='core'?'Первичный ключ':'Логический ключ источника'}</h3><code className="entity-key">{entity.key}</code><p className="entity-note">{stage==='raw'?'Исходные записи сохраняются без изменений; типы, ключи и связи задаются в core.':entity.note}</p></div>
        {stage!=='raw'?<><div className="field-table"><table><thead><tr><th>Поле</th><th>Тип / роль</th></tr></thead><tbody>{entity.fields.map(f=><tr key={f.name}><td><code>{f.name}</code>{f.nullable&&<span className="nullable">NULL допустим</span>}</td><td>{f.type}{f.role&&<span className="field-role">{f.role}</span>}</td></tr>)}</tbody></table>{!entity.fields.length&&<p className="entity-note">Состав полей недоступен без подключения к базе.</p>}</div>
          <div className="entity-body"><h3>{stage==='mart'?'Источники и зависимости':'Связи и витрины'}</h3>{links.filter(r=>r.from===fullName||r.to===fullName).map(r=>{const target=r.from===fullName?r.to:r.from;return <button className="entity-relation" type="button" key={`${r.from}-${r.to}`} onClick={()=>select(target)}><GitBranch size={14}/><span>{target}<small>{r.label} · {r.cardinality}</small></span><ArrowUpRight size={14}/></button>;})}</div>
        </>:<div className="entity-body"><h3>Преобразования в core</h3><ul className="raw-rules"><li>Пустые значения → NULL</li><li>Денежные суммы → numeric</li><li>Даты → timestamp / date</li><li>Проверка ключей и ссылок</li></ul><button type="button" className="button wide" onClick={()=>setStage('core')}>Открыть поля core<ArrowRight size={15}/></button></div>}
      </aside>}
      </div><p className="model-boundary">core хранит связанные сущности; mart формирует аналитические срезы. SQL-зависимости витрин не являются внешними ключами.</p>
    </>}
  </>;
}
function BarIcon() { return <GitBranch size={18}/>; }
