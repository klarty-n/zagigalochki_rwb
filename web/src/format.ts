export const integer = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
export const decimal = (n: number, digits = 2) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
// Currency is declared in the page caption; keep repeated amounts uncluttered.
export const money = (cents: number) => decimal(cents / 100);
export function shortMoney(cents: number) {
  const n = cents / 100;
  if (Math.abs(n) >= 1e6) return `${decimal(n / 1e6)} млн`;
  if (Math.abs(n) >= 1e4) return `${decimal(n / 1e3, 1)} тыс.`;
  return money(cents);
}
export const monthLabel = (month: string, long = false) => new Intl.DateTimeFormat('ru-RU', {
  month: long ? 'long' : 'short', year: 'numeric',
}).format(new Date(`${month}-01T12:00:00`)).replace(/\s?г\.$/, '').replace('.', '');
export const periodLabel = (start: string, end: string) => start === end ? monthLabel(start, true) : `${monthLabel(start)} — ${monthLabel(end)}`;
export const states: Record<string, string> = {
  SP: 'Сан-Паулу', RJ: 'Рио-де-Жанейро', MG: 'Минас-Жерайс', PR: 'Парана', RS: 'Риу-Гранди-ду-Сул',
  SC: 'Санта-Катарина', BA: 'Баия', PE: 'Пернамбуку', ES: 'Эспириту-Санту', DF: 'Федеральный округ',
  CE: 'Сеара', GO: 'Гояс', PA: 'Пара', MA: 'Мараньян', MT: 'Мату-Гросу', MS: 'Мату-Гросу-ду-Сул',
  PB: 'Параиба', RN: 'Риу-Гранди-ду-Норти', AL: 'Алагоас', SE: 'Сержипи', PI: 'Пиауи', TO: 'Токантинс',
  RO: 'Рондония', AC: 'Акри', AM: 'Амазонас', RR: 'Рорайма', AP: 'Амапа',
};
