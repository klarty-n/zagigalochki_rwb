import { createApp } from './app.mjs';
import { makeDemoData } from './demo.mjs';
import { createMartProvider } from './mart.mjs';
import { createCoreProvider } from './core.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const source = process.env.DATA_SOURCE || 'team-snapshot';
if (!['demo', 'core', 'mart', 'team-snapshot'].includes(source)) throw new Error('DATA_SOURCE должен быть demo, core, mart или team-snapshot.');
const demo = source === 'demo' ? makeDemoData() : null;
const provider = source === 'mart' ? createMartProvider(process.env.DATABASE_URL) : source === 'core' ? createCoreProvider(process.env.DATABASE_URL) : { getData: async () => {
  if (source === 'team-snapshot') throw new Error('Снимок SQL не содержит отдельных заказов. Для детализации подключите core.');
  return demo;
}, close: async () => {} };
const port = Number(process.env.PORT || 3001);
const server = createApp(provider, source).listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Capibara API: http://localhost:${port} · source=${source}`);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  server.close(async () => { await provider.close(); process.exit(0); });
});
