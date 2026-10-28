import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { InputError, parseFilters, summarize } from './analytics.mjs';
import { inspectQuality, listOrders, orderDetail, parseOrderQuery } from './explorer.mjs';
import { modelPayload } from './model.mjs';
import { teamSnapshot, verifyTeamSnapshot } from './team-snapshot.mjs';

export function createApp(provider, source) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', source }));
  app.get('/api/overview', async (req, res) => {
    try {
      const filters = parseFilters(req.query);
      if (source === 'team-snapshot') {
        if (filters.start !== '2016-09' || filters.end !== '2018-08' || filters.state !== 'all') throw new InputError('SQL-снимок команды доступен только целиком. Для фильтрации подключите core.');
        verifyTeamSnapshot();
        return res.set('Cache-Control', 'no-store').json(teamSnapshot);
      }
      if (source === 'mart') return res.set('Cache-Control', 'no-store').json(await provider.getOverview(filters));
      const data = await provider.getData();
      if (filters.state !== 'all' && !data.orders.some(o => o.state === filters.state)) throw new InputError('Штат отсутствует в данных.');
      res.set('Cache-Control', 'no-store').json(summarize(data, filters));
    } catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      console.error('[overview]', error.message);
      return res.status(503).json({ error: 'Не удалось прочитать данные. Проверьте подключение и соответствие схем core/mart контракту команды.' });
    }
  });
  const handle = fn => async (req, res) => {
    try { res.set('Cache-Control', 'no-store'); await fn(req, res); }
    catch (error) {
      if (error instanceof InputError) return res.status(400).json({ error: error.message });
      console.error('[explorer]', error.message);
      res.status(503).json({ error: 'Источник данных недоступен. Проверьте подключение к core.' });
    }
  };
  app.get('/api/orders', handle(async (req, res) => {
    const query = parseOrderQuery(req.query);
    const data = await provider.getData();
    if (query.state !== 'all' && !data.orders.some(o => o.state === query.state)) throw new InputError('Штат отсутствует в данных.');
    res.json(listOrders(data, query));
  }));
  app.get('/api/orders/:id', handle(async (req, res) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(req.params.id)) throw new InputError('Некорректный ID заказа.');
    const result = orderDetail(await provider.getData(), req.params.id);
    if (!result) return res.status(404).json({ error: 'Заказ не найден в текущем источнике.' });
    res.json(result);
  }));
  app.get('/api/quality', handle(async (_req, res) => res.json(inspectQuality(await provider.getData()))));
  app.get('/api/model', handle(async (_req, res) => {
    // The documented schema remains usable when the database is offline; counts do not.
    const data = await provider.getData().catch(() => null);
    res.json(modelPayload(data, source));
  }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API-маршрут не найден.' }));
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
