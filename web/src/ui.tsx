import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, RefreshCw, X } from 'lucide-react';

export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-content"><div className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Закрыть окно" onClick={onClose}><X size={20} /></button></div>{children}</div>
  </dialog>;
}
export function InfoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="info-button" aria-label={`Информация: ${label}`} onClick={onClick}><Info size={15} /></button>;
}
export function useApi<T>(url: string, revision = 0) {
  const [data, setData] = useState<T | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError('');
    fetch(url, { signal: abort.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Не удалось загрузить данные.'); return body as T; })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [url, revision, attempt]);
  return { data, loading, error, retry: () => setAttempt(a => a + 1) };
}
export function ApiFeedback({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (error) return <div className="page-feedback" role="alert"><p>{error}</p><button type="button" className="button" onClick={retry}><RefreshCw size={15} />Повторить</button></div>;
  return loading ? <div className="page-feedback" role="status"><RefreshCw size={21} className="spinning" /><p>Загружаем данные…</p></div> : null;
}
export const dateTime = (v: string | null | undefined, withTime = true) => !v ? 'Нет данных' : new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', ...(withTime && v.includes('T') ? { hour: '2-digit', minute: '2-digit' } : {}),
}).format(new Date(v.includes('T') ? v : `${v}T12:00:00`));
