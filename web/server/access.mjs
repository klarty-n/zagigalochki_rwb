import { createHash, timingSafeEqual } from 'node:crypto';

// Optional shared team access for a publicly hosted dashboard. Database credentials
// never reach the browser. Local development remains unchanged without a password.
export function teamAccess({ username = 'team', password } = {}) {
  if (!password) return (_req,_res,next) => next();
  if (password.length < 16) throw new Error('DASHBOARD_PASSWORD must contain at least 16 characters.');
  const digest = value => createHash('sha256').update(value).digest();
  const expected = digest(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  return (req,res,next) => {
    if (req.path === '/api/health') return next();
    if (timingSafeEqual(digest(req.headers.authorization || ''),expected)) return next();
    res.set('WWW-Authenticate','Basic realm="Capibara team", charset="UTF-8"');
    res.set('Cache-Control','no-store');
    return res.status(401).send('Для доступа к дашборду войдите под учётной записью команды.');
  };
}
