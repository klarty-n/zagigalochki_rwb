#!/usr/bin/env python3
"""Validate and export 5 core queries. --source-reference tests their logic on raw
through explicit inline contract adapters, without creating or changing core.
Default mode only reads the real core; missing core is an error.
"""
import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
NAMES=['01_monthly_revenue','02_top_sellers','03_average_order','04_repeat_customers','05_category_revenue']
RAW=['orders','order_items','order_payments','order_reviews','products','sellers','customers','product_category_translation']
REQUIRED={
 'orders':['order_id','customer_id','order_status','order_purchase_at'],
 'order_items':['order_id','order_item_id','product_id','seller_id','price','freight_value'],
 'customers':['customer_id','customer_unique_id'],
 'products':['product_id','category_name'],
 'sellers':['seller_id','city','state'],
 'categories':['category_name','category_name_english'],
}
# Diagnostics only: these subqueries emulate documented column renames and types.
# They are NEVER installed as team core views/tables and never used in default mode.
ADAPTER={
 'orders':"""SELECT order_id,customer_id,order_status,
 NULLIF(btrim(order_purchase_timestamp),'')::timestamp AS order_purchase_at FROM raw.orders""",
 'order_items':"""SELECT order_id,NULLIF(btrim(order_item_id),'')::integer AS order_item_id,
 product_id,seller_id,NULLIF(btrim(price),'')::numeric(12,2) AS price,
 NULLIF(btrim(freight_value),'')::numeric(12,2) AS freight_value FROM raw.order_items""",
 'customers':"SELECT customer_id,customer_unique_id FROM raw.customers",
 'products':"SELECT product_id,NULLIF(btrim(product_category_name),'') AS category_name FROM raw.products",
 'sellers':"SELECT seller_id,seller_city AS city,seller_state AS state FROM raw.sellers",
 'categories':"""SELECT n.category_name,NULLIF(btrim(t.product_category_name_english),'') AS category_name_english
 FROM (
 SELECT NULLIF(btrim(product_category_name),'') AS category_name FROM raw.products
 UNION SELECT NULLIF(btrim(product_category_name),'') FROM raw.product_category_translation
 ) AS n LEFT JOIN raw.product_category_translation AS t ON t.product_category_name=n.category_name
 WHERE n.category_name IS NOT NULL""",
}

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--source-reference',action='store_true')
 p.add_argument('--local-psql',action='store_true',help='use psql and DATABASE_URL instead of Docker')
 args=p.parse_args()
 out=ROOT/'results/block_a';out.mkdir(parents=True,exist_ok=True)
 manifest={'status':'running','started_at_utc':datetime.now(timezone.utc).isoformat(),
           'validation_scope':'raw_reference_only' if args.source_reference else 'team_core',
           'core_queries_verified':False,'ready_for_submission':False,'checks':[]}
 manifest_path=out/'verification.json'
 def save():manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 save()
 try:
  if args.local_psql:
   if not shutil.which('psql'):raise RuntimeError('psql is not installed')
   base=['psql',os.environ.get('DATABASE_URL','postgresql://hack:hack@localhost:5433/marketplace')]
  else:base=['docker','compose','exec','-T','postgres','psql','-U','hack','-d','marketplace']
  base+=['-X','-v','ON_ERROR_STOP=1','-P','pager=off']
  def call(q,tuples=True):
   cmd=base+(['-At'] if tuples else [])+['-c',q]
   r=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,encoding='utf-8')
   if r.returncode:raise RuntimeError(r.stderr[-10000:])
   return r.stdout.strip() if tuples else r.stdout
  def adapt(q):
   if not args.source_reference:return q
   return re.sub(r'\bcore\.(orders|order_items|customers|products|sellers|categories)\b',
                 lambda m:'('+ADAPTER[m.group(1)]+')',q)
  def scalar(q):return call(adapt(q))
  def check(label,ok):
   manifest['checks'].append({'name':label,'passed':bool(ok)})
   if not ok:raise RuntimeError('Check failed: '+label)
  def snapshot_raw():
   result={}
   for name in RAW:
    s=call("SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM raw."+name+' AS t')
    n,digest=s.split('|');result[name]={'rows':int(n),'digest':digest}
   return result
  manifest['server_version']=call('SHOW server_version')
  manifest['database']=call('SELECT current_database()')
  manifest['observed_core_columns']=call("SELECT table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='core' ORDER BY table_name,ordinal_position").splitlines()
  if not args.source_reference:
   missing=[t+'.'+c for t,cols in REQUIRED.items() for c in cols if t+'.'+c not in manifest['observed_core_columns']]
   if missing:raise RuntimeError('Core is not ready. Missing columns: '+', '.join(missing))
  raw_before=snapshot_raw();manifest['raw_snapshot']=raw_before
  for t,keys in [('orders','order_id'),('order_items','(order_id,order_item_id)'),('customers','customer_id'),('products','product_id'),('sellers','seller_id'),('categories','category_name')]:
   check(t+': unique keys',scalar(f'SELECT count(*)=count(DISTINCT {keys}) FROM core.{t} AS t')=='t')
  for t,cond in [('orders','order_id IS NULL OR customer_id IS NULL OR order_purchase_at IS NULL OR order_status IS NULL'),
                 ('order_items','order_id IS NULL OR product_id IS NULL OR seller_id IS NULL OR price IS NULL OR freight_value IS NULL OR price<0 OR freight_value<0'),
                 ('customers','customer_unique_id IS NULL OR customer_id IS NULL')]:
   check(t+': required values',scalar(f'SELECT NOT EXISTS(SELECT 1 FROM core.{t} AS t WHERE {cond})')=='t')
  for child,parent,ck,pk in [('orders','customers','customer_id','customer_id'),('order_items','orders','order_id','order_id'),('order_items','products','product_id','product_id'),('order_items','sellers','seller_id','seller_id'),('products','categories','category_name','category_name')]:
   check(child+' -> '+parent+': no orphans',scalar(f'SELECT NOT EXISTS(SELECT 1 FROM core.{child} AS x LEFT JOIN core.{parent} AS y ON x.{ck}=y.{pk} WHERE x.{ck} IS NOT NULL AND y.{pk} IS NULL)')=='t')
  check('delivered: all have items',scalar("SELECT NOT EXISTS(SELECT 1 FROM core.orders AS o WHERE o.order_status='delivered' AND NOT EXISTS(SELECT 1 FROM core.order_items AS i WHERE i.order_id=o.order_id))")=='t')
  # Default core mode also verifies that migration preserved counts and money.
  if not args.source_reference:
   for name in ['orders','order_items','customers','products','sellers']:
    check(name+': source rows preserved',int(scalar(f'SELECT count(*) FROM core.{name} AS t'))==raw_before[name]['rows'])
   for column in ['price','freight_value']:
    check(column+': source sum preserved',scalar(f'SELECT sum({column}) FROM core.order_items AS t')==call(f'SELECT sum({column}::numeric) FROM raw.order_items'))
  with tempfile.TemporaryDirectory(prefix='block-a-') as tmp:
   stage=Path(tmp);rows={};queries={}
   for name in NAMES:
    payload=(ROOT/'queries'/f'{name}.sql').read_bytes();queries[name]=payload
    q=payload.decode('utf-8').strip().rstrip(';')
    if re.search(r'\braw\.',q,re.I):raise RuntimeError('Submitted SQL must not query raw: '+name)
    content=call('COPY (\n'+adapt(q)+'\n) TO STDOUT WITH (FORMAT csv, HEADER true)',False)
    (stage/f'{name}.csv').write_text(content)
    rows[name]=list(csv.DictReader(io.StringIO(content)))
   monthly=rows[NAMES[0]];sellers=rows[NAMES[1]];avg=rows[NAMES[2]];buyers=rows[NAMES[3]];categories=rows[NAMES[4]]
   D=Decimal
   check('Q1: exactly requested columns',list(monthly[0])==['month','orders','revenue'])
   check('Q1: 24 months',len(monthly)==24)
   calendar=[f'{2016+(8+i)//12:04d}-{(8+i)%12+1:02d}-01' for i in range(24)]
   check('Q1: full ordered calendar',[r['month'] for r in monthly]==calendar)
   check('Q1: one zero revenue month',sum(D(r['revenue'])==0 for r in monthly)==1)
   check('Q1: November preserved',next(r for r in monthly if r['month']=='2016-11-01')['orders']=='0')
   check('Q1: reference sum',sum(D(r['revenue']) for r in monthly)==D('13221498.11'))
   check('Q1: delivered order count',sum(int(r['orders']) for r in monthly)==96478)
   check('Q2: exactly ten sellers',len(sellers)==10)
   check('Q2: leader amount',D(sellers[0]['revenue'])==D('226987.93'))
   check('Q2: descending revenue',[D(r['revenue']) for r in sellers]==sorted([D(r['revenue']) for r in sellers],reverse=True))
   check('Q3: one row',len(avg)==1)
   check('Q3: order-level check',D(avg[0]['average_order_value'])==D('159.88'))
   check('Q3: units >= distinct product-seller lines',D(avg[0]['average_units'])>=D(avg[0]['average_item_lines']))
   check('Q4: one row',len(buyers)==1)
   check('Q4: people',int(buyers[0]['customers'])==96096)
   check('Q4: repeat people',int(buyers[0]['repeat_customers'])==2997)
   check('Q4: repeat percent',D(buyers[0]['repeat_percent'])==D('3.12'))
   check('Q5: categories',len(categories)==74)
   check('Q5: leading amount',D(categories[0]['revenue'])==D('1233131.72'))
   check('Q5: full amount',sum(D(r['revenue']) for r in categories)==D('13221498.11'))
   check('Q5: Unknown included',any(r['category']=='Не указана' and D(r['revenue'])>0 for r in categories))
   check('Q5: rounded shares near 100',abs(sum(D(r['share_percent']) for r in categories)-100)<D('0.0001'))
   # Independent raw control uses EXISTS and distinct orders, not the query's join/CTE layout.
   independent=call("SELECT sum(i.price::numeric) FROM raw.order_items AS i WHERE EXISTS(SELECT 1 FROM raw.orders AS o WHERE o.order_id=i.order_id AND o.order_status='delivered' AND o.order_purchase_timestamp::timestamp>='2016-09-01'::timestamp AND o.order_purchase_timestamp::timestamp<'2018-09-01'::timestamp)")
   check('Q1: independent raw sum',sum(D(r['revenue']) for r in monthly)==D(independent))
   check('raw unchanged',raw_before==snapshot_raw())
   if any((ROOT/'queries'/f'{n}.sql').read_bytes()!=queries[n] for n in NAMES):
    raise RuntimeError('SQL files changed during verification; rerun after saving edits.')
   manifest['query_sha256']={n:hashlib.sha256(queries[n]).hexdigest() for n in NAMES}
   manifest['runner_sha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
   manifest['output_rows']={n:len(rows[n]) for n in NAMES}
   manifest['results_sha256']={n:hashlib.sha256((stage/f'{n}.csv').read_bytes()).hexdigest() for n in NAMES}
   manifest['local_commit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
   manifest['core_queries_verified']=not args.source_reference
   manifest['ready_for_submission']=not args.source_reference
   manifest['status']='passed';manifest['completed_at_utc']=datetime.now(timezone.utc).isoformat()
   for f in stage.iterdir():shutil.copy2(f,out/f.name)
   save()
   print('PASS:',len(manifest['checks']),'checks;',manifest['validation_scope'],'; CSV rows:',manifest['output_rows'])
   if args.source_reference:print('NOTE: CSV are source-reference results; run default mode after real core is loaded.')
 except Exception as e:
  manifest['status']='failed';manifest['error']=str(e);save()
  print('FAIL:',e,file=sys.stderr)
  print('Existing CSV may be stale. Inspect verification.json.',file=sys.stderr)
  return 1
 return 0

if __name__=='__main__':sys.exit(main())
