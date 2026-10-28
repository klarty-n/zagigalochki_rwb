import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';

test('cloud team access protects API and site; health stays available without DB disclosure', async t => {
  const app=createApp({getData:async()=>{throw new Error('unused');}},'mart',
    {username:'team',password:'test-password-very-long'});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/api/health')).status,200);
  for (const path of ['/','/api/model','/api/orders']) {
    const response=await fetch(base+path);
    assert.equal(response.status,401);
    assert.match(response.headers.get('www-authenticate'),/Basic/);
  }
  assert.equal((await fetch(base+'/api/model',{headers:{authorization:'Basic '+Buffer.from('team:wrong').toString('base64')}})).status,401);
  const success=await fetch(base+'/api/model',{headers:{authorization:'Basic '+Buffer.from('team:test-password-very-long').toString('base64')}});
  assert.equal(success.status,200);
});
