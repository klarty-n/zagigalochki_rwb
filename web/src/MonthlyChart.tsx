import { useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, CircleHelp, Table2 } from 'lucide-react';
import { InfoButton } from './ui';
import { decimal, integer, money, monthLabel } from './format';
import type { MonthPoint } from './types';

function MonthlyTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: MonthPoint }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="chart-tooltip combined-tooltip"><span>{monthLabel(point.month, true)}</span>
    <div className="tooltip-metric revenue"><i /><span>Выручка, BRL</span><strong>{money(point.revenueCents)}</strong></div>
    <div className="tooltip-metric orders"><i /><span>Доставленные заказы</span><strong>{integer(point.orders)}</strong></div>
    <small>Нажмите, чтобы открыть месяц</small></div>;
}

export function MonthlyChart({ monthly, onInfo, onMonth }: { monthly: MonthPoint[]; onInfo: () => void; onMonth: (point: MonthPoint) => void }) {
  const [tableOpen, setTableOpen] = useState(false);
  return <section className="panel chart-panel" aria-labelledby="chart-title">
    <div className="panel-heading chart-heading"><div className="heading-line"><h2 id="chart-title">Выручка и заказы по месяцам</h2><InfoButton label="Динамика по месяцам" onClick={onInfo} /></div>
      <div className="combined-legend" aria-label="Показатели графика"><span className="legend-revenue"><i />Выручка, BRL</span><span className="legend-orders"><i />Заказы, шт.</span></div></div>
    <div className="chart-meta combined-axis-captions"><span>Выручка, BRL · левая шкала</span><span>Заказы, шт. · правая шкала</span></div>
    <div className="chart-canvas" role="img" aria-label="Выручка и доставленные заказы по месяцам. Розовая линия — BRL слева; бирюзовый пунктир — число заказов справа. Точные значения доступны в таблице ниже.">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={monthly} margin={{ top: 14, right: 0, left: 0, bottom: 3 }} onClick={state => { const point = monthly.find(p => p.month === state.activeLabel); if (point) onMonth(point); }}>
          <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c800a1" stopOpacity={0.1} /><stop offset="100%" stopColor="#c800a1" stopOpacity={0.01} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#eee8f1" strokeDasharray="3 5" />
          <XAxis dataKey="month" axisLine={false} tickLine={false} minTickGap={55} tickMargin={14} tickFormatter={v => monthLabel(v)} tick={{ fill: '#776d80', fontSize: 12 }} />
          <YAxis yAxisId="revenue" width={64} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} allowDecimals={false} tick={{ fill: '#ae2573', fontSize: 12 }} tickFormatter={v => {
            const n = v / 100;
            return n >= 1000000 ? `${decimal(n / 1000000, 1)} млн` : n >= 1000 ? `${decimal(n / 1000, 0)} тыс.` : integer(n);
          }} />
          <YAxis yAxisId="orders" orientation="right" width={52} axisLine={false} tickLine={false} tickCount={5} domain={[0, 'auto']} allowDecimals={false} tick={{ fill: '#207f91', fontSize: 12 }} tickFormatter={v => v >= 1000 ? `${decimal(v / 1000, 0)} тыс.` : integer(v)} />
          <Tooltip content={<MonthlyTooltip />} cursor={{ stroke: '#85718c', strokeDasharray: '3 4', strokeOpacity: 0.3 }} />
          <Area yAxisId="revenue" type="linear" dataKey="revenueCents" name="Выручка" stroke="#c800a1" fill="url(#revenueFill)" strokeWidth={2.5} dot={{ r: 2.6, strokeWidth: 0, fill: '#c800a1' }} activeDot={{ r: 5, fill: '#c800a1', stroke: 'white', strokeWidth: 3 }} isAnimationActive={false} />
          <Line yAxisId="orders" type="linear" dataKey="orders" name="Заказы" stroke="#207f91" strokeWidth={2.8} strokeDasharray="7 4" dot={{ r: 2.8, fill: 'white', stroke: '#207f91', strokeWidth: 1.5 }} activeDot={{ r: 5, fill: '#207f91', stroke: 'white', strokeWidth: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <p className="chart-scale-note">Две независимые шкалы: сравнивайте динамику, а не высоту линий.</p>
    <div className="chart-footer"><button type="button" className="text-button" aria-expanded={tableOpen} onClick={() => setTableOpen(!tableOpen)}><Table2 size={14} />{tableOpen ? 'Скрыть таблицу' : 'Показать таблицу'}</button><button type="button" className="button calculation" onClick={onInfo}><CircleHelp size={16} />Как рассчитано?</button></div>
    {tableOpen && <div className="table-scroll monthly-table"><table><caption className="sr-only">Выручка и заказы по месяцам</caption><thead><tr><th>Месяц</th><th className="number">Заказы</th><th className="number">Выручка, BRL</th><th><span className="sr-only">Действие</span></th></tr></thead><tbody>{monthly.map(point => <tr key={point.month}><td>{monthLabel(point.month, true)}</td><td className="number">{integer(point.orders)}</td><td className="number">{decimal(point.revenueCents / 100)}</td><td><button type="button" className="icon-button" aria-label={`Открыть ${monthLabel(point.month, true)}`} onClick={() => onMonth(point)}><ArrowUpRight size={16} /></button></td></tr>)}</tbody></table></div>}
  </section>;
}
