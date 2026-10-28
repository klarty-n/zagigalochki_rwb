// Live check of the deployed website. Secrets are read locally, never printed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const access=JSON.parse(fs.readFileSync(new URL('../deploy/secrets/dashboard-access.json',import.meta.url),'utf8'));
const base='https://capibara-marketplace.onrender.com';
const headers={authorization:'Basic '+Buffer.from(access.username+':'+access.password).toString('base64')};
async function get(path){
  const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(90000)});
  assert.equal(r.status,200,path);
  return r.json();
}
try {
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/overview')).status,401);
  const overview=await get('/api/overview');
  assert.equal(overview.meta.source,'mart');
  assert.equal(overview.kpis.revenueCents,1322149811);
  assert.equal(overview.monthly.length,24);
  const orders=await get('/api/orders?pageSize=2&status=delivered');
  assert.equal(orders.items.length,2);
  const detail=await get('/api/orders/'+orders.items[0].id);
  assert.ok(detail.items.length);
  const quality=await get('/api/quality');
  assert.equal(quality.orderCount,99441);
  const model=await get('/api/model');
  assert.equal(model.marts.length,8);
  assert.equal(model.entities.length,11);
  assert.equal(model.entities.find(e=>e.id==='order_address_snapshot').count,99441);
  assert.equal(model.entities.find(e=>e.id==='order_item_category_snapshot').count,112650);
  assert.ok(model.entities.find(e=>e.id==='seller_product_category_history').count>0);
  assert.equal(model.martAvailable,true);
  const filtered=await get('/api/overview?start=2016-11&end=2016-11&state=all');
  assert.equal(filtered.kpis.revenueCents,0);
  const report={status:'passed',url:base,checked_at:new Date().toISOString(),source:overview.meta.source,
    revenue:overview.kpis.revenueCents/100,months:overview.monthly.length,orders:quality.orderCount,marts:model.marts.length,
    endpoints:['health','overview','orders','order detail','quality','model'],authentication:'anonymous 401, authenticated 200'};
  fs.writeFileSync(new URL('../reports/cloud-live-check.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch(error) { console.error('Cloud check failed:',error.message);process.exitCode=1; }
