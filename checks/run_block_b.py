#!/usr/bin/env python3
"""Export block B from core, independently reconcile counts and publish a manifest.
Uses psql from PATH and DATABASE_URL; never writes to the database.
"""
import csv
from datetime import datetime, timezone
from decimal import Decimal as D
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
NAMES=['06_product_price_history','07_delivery_by_state','08_status_funnel',
       '09_payments_by_state','09_payment_methods','10_reviews_and_delivery']
BASE=['psql','-X',os.environ.get('DATABASE_URL','postgresql://hack:hack@127.0.0.1:5433/marketplace'),
      '-v','ON_ERROR_STOP=1','-q','--csv','-P','pager=off']

def query(sql):
    run=subprocess.run(BASE+['-c','BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','-c',sql,'-c','COMMIT'],
                       capture_output=True,text=True,encoding='utf-8',check=True)
    return run.stdout,list(csv.DictReader(io.StringIO(run.stdout)))

def main():
    out=ROOT/'results/block_b';out.mkdir(exist_ok=True,parents=True)
    report={'status':'running','source':'core','checked_at_utc':datetime.now(timezone.utc).isoformat(),
            'checks':[],'history_structure_verified':False, 'history_note':'Snapshot coverage is tested here; behavioral history test is checks/history.sql'}
    results={}; texts={}; checks=report['checks']
    def check(name,condition):
        checks.append({'name':name,'passed':bool(condition)})
        if not condition: raise AssertionError(name)
    def total(sql):return D(next(iter(query(sql)[1][0].values())))
    try:
        for name in NAMES:
            sql=(ROOT/'queries'/f'{name}.sql').read_text()
            text,rows=query(sql);results[name]=rows;texts[name]=text
        check('Every order has an address snapshot',total('SELECT COUNT(*) FROM core.order_address_snapshot;')==total('SELECT COUNT(*) FROM core.orders;'))
        check('Every item has a category snapshot',total('SELECT COUNT(*) FROM core.order_item_category_snapshot;')==total('SELECT COUNT(*) FROM core.order_items;'))
        check('Category intervals cannot overlap',total("SELECT COUNT(*) FROM pg_constraint WHERE conrelid='core.seller_product_category_history'::regclass AND conname='offer_category_no_overlap';")==1)
        check('Both historical snapshots protected',total("SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled<>'D' AND tgname IN ('immutable_order_address','immutable_item_category');")==2)
        report['history_structure_verified']=True
        price=results[NAMES[0]];state=results[NAMES[1]];funnel=results[NAMES[2]]
        payments=results[NAMES[3]];methods=results[NAMES[4]];scores=results[NAMES[5]]
        selection=query("""SELECT i.product_id,COUNT(DISTINCT i.price) AS prices,COUNT(*) AS units
          FROM core.order_items i JOIN core.orders o USING(order_id) WHERE o.order_status='delivered'
          GROUP BY i.product_id ORDER BY prices DESC,i.product_id LIMIT 1;""")[1][0]
        report['selected_product']=selection
        check('Q6 all units of selected product',sum(int(r['units']) for r in price)==int(selection['units']))
        check('Q6 maximal distinct prices',len({D(r['price']) for r in price})==int(selection['prices']))
        check('Q6 date-price pairs unique',len({(r['sale_date'],r['price']) for r in price})==len(price))
        check('Q7 states unique and >=500',len({r['state'] for r in state})==len(state) and all(int(r['orders'])>=500 for r in state))
        check('Q7 eligible order count',sum(int(r['orders']) for r in state)==total("""SELECT COALESCE(SUM(n),0) FROM (
          SELECT COUNT(*) n FROM core.orders o JOIN core.order_address_snapshot c USING(order_id)
          WHERE order_status='delivered' GROUP BY c.state HAVING COUNT(*)>=500) q;"""))
        check('Q8 all orders preserved',sum(int(r['orders']) for r in funnel)==total('SELECT COUNT(*) FROM core.orders;'))
        check('Q8 no-item count independently reconciled',sum(int(r['orders_without_items']) for r in funnel)==total(
          'SELECT COUNT(*) FROM core.orders o LEFT JOIN (SELECT DISTINCT order_id FROM core.order_items) i USING(order_id) WHERE i.order_id IS NULL;'))
        check('Q8 shares sum to 100',abs(sum(D(r['share_percent']) for r in funnel)-100)<D('0.00001'))
        check('Q9a all 2018 payment records',sum(int(r['payments']) for r in payments)==total("""SELECT COUNT(*) FROM core.order_payments p
          WHERE EXISTS(SELECT 1 FROM core.orders o WHERE o.order_id=p.order_id AND order_purchase_at>=date '2018-01-01' AND order_purchase_at<date '2019-01-01');"""))
        check('Q9a independent amount',sum(D(r['payment_value']) for r in payments)==total("""SELECT SUM(p.payment_value) FROM core.order_payments p
          WHERE EXISTS(SELECT 1 FROM core.orders o WHERE o.order_id=p.order_id AND order_purchase_at>=date '2018-01-01' AND order_purchase_at<date '2019-01-01');"""))
        check('Q9b all-time payments preserved',sum(int(r['payments']) for r in methods)==total('SELECT COUNT(*) FROM core.order_payments;'))
        check('Q10 scores 1..5 preserved',[int(r['score']) for r in scores]==list(range(1,6)))
        check('Q10 one reviewed delivered order counted once',sum(int(r['orders']) for r in scores)==total("""SELECT COUNT(*) FROM core.orders o
          WHERE order_status='delivered' AND EXISTS(SELECT 1 FROM core.order_reviews r WHERE r.order_id=o.order_id);"""))
        for group in [state,scores]:
            check('Delivery percentages and means valid',all((not r['late_percent'] or 0<=D(r['late_percent'])<=100)
                and (not r['average_delivery_days'] or D(r['average_delivery_days'])>=0) for r in group))
        diagnostic=[]
        for statement in (ROOT/'checks/block_b_diagnostics.sql').read_text().split(';'):
            if statement.strip(): diagnostic.append(query(statement+';')[0])
        (out/'diagnostics.csv.txt').write_text('\n'.join(diagnostic))
        report['queries']={n:{'rows':len(results[n]),'sql_sha256':hashlib.sha256((ROOT/'queries'/f'{n}.sql').read_bytes()).hexdigest(),
                               'csv_sha256':hashlib.sha256(texts[n].encode()).hexdigest()} for n in NAMES}
        for n in NAMES:(out/f'{n}.csv').write_text(texts[n])
        report['status']='passed'
    except Exception as error:
        report['status']='failed';report['error']=str(error)
        raise
    finally:(out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(f'PASS: {len(checks)} checks; product={selection["product_id"]}; '+str({n:len(results[n]) for n in NAMES}))

if __name__=='__main__':main()
