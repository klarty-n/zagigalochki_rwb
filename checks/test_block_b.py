#!/usr/bin/env python3
"""SQL edge cases in temporary tables. No writes to core/raw; transaction rolled back."""
import csv
import io
from pathlib import Path
import subprocess
import tempfile
from run_block_b import ROOT,BASE

def main():
    setup="""
BEGIN;
CREATE TEMP TABLE test_orders(order_id text,customer_id text,order_status text,order_purchase_at timestamp,
 delivered_customer_at timestamp,estimated_delivery_date date);
CREATE TEMP TABLE test_order_address_snapshot(order_id text,state text);
CREATE TEMP TABLE test_customers(customer_id text,state text);
CREATE TEMP TABLE test_order_items(order_id text,product_id text,seller_id text,price numeric);
CREATE TEMP TABLE test_order_payments(order_id text,payment_type text,payment_value numeric,payment_installments int);
CREATE TEMP TABLE test_order_reviews(order_id text,review_id text,review_score int,review_answered_at timestamp,review_created_at timestamp);
INSERT INTO test_customers VALUES ('a','SP'),('b','RJ'),('x','XX'),('y','YY');
INSERT INTO test_orders VALUES
 ('a','a','delivered','2018-01-01 12:00','2018-01-03 12:00','2018-01-03'),
 ('b','a','delivered','2018-01-01','2018-01-06','2018-01-03'),
 ('c','b','canceled','2018-01-01',NULL,NULL),
 ('d','a','delivered','2018-01-04','2018-01-03','2018-01-05'),
 ('e','a','delivered','2018-01-01',NULL,'2018-01-05'),
 ('f','b','shipped','2017-01-01',NULL,NULL);
INSERT INTO test_orders SELECT 'x'||g,'x','delivered','2018-01-01','2018-01-06','2018-01-03' FROM generate_series(1,499) g;
INSERT INTO test_orders SELECT 'y'||g,'y','delivered','2018-01-01 12:00','2018-01-03 12:00','2018-01-03' FROM generate_series(1,500) g;
INSERT INTO test_order_address_snapshot SELECT o.order_id,c.state FROM test_orders o JOIN test_customers c USING(customer_id);
INSERT INTO test_order_items VALUES ('a','p1','s1',10),('a','p1','s1',10),('b','p1','s2',20),('d','p2','s1',8),('e','p3','s1',0);
INSERT INTO test_order_payments VALUES ('a','credit_card',15,2),('a','voucher',5,1),('c','credit_card',7,0),('f','voucher',9,1);
INSERT INTO test_order_reviews VALUES
 ('a','r1',1,'2018-01-04','2018-01-04'),('a','r2',5,'2018-01-05','2018-01-05'),
 ('b','r3',2,'2018-01-07','2018-01-07'),('d','r4',5,'2018-01-05','2018-01-05'),('e','r5',4,'2018-01-07','2018-01-07');
"""
    names=['06_product_price_history','07_delivery_by_state','08_status_funnel',
           '09_payments_by_state','09_payment_methods','10_reviews_and_delivery']
    with tempfile.TemporaryDirectory(prefix='block-b-sql-') as temp:
        script=setup
        for name in names:
            sql=(ROOT/'queries'/f'{name}.sql').read_text()
            sql='\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--')).strip().rstrip(';')
            for table in ['order_address_snapshot','orders','customers','order_items','order_payments','order_reviews']:
                sql=sql.replace('core.'+table,'pg_temp.test_'+table)
            script+=f"\\copy ({' '.join(sql.splitlines())}) TO '{temp}/{name}.csv' WITH CSV HEADER\n"
        script+='ROLLBACK;\n'
        subprocess.run(BASE+['-f','-'],input=script,text=True,capture_output=True,check=True)
        rows={name:list(csv.DictReader(io.StringIO(Path(temp,f'{name}.csv').read_text()))) for name in names}
    assert rows[names[0]]==[{'sale_date':'2018-01-01','price':'10','units':'2'}, {'sale_date':'2018-01-01','price':'20','units':'1'}]
    assert rows[names[1]]==[{'state':'YY','orders':'500','average_delivery_days':'2.00','late_percent':'0.00'}]
    assert sum(int(r['orders']) for r in rows[names[2]])==1005
    assert next(r for r in rows[names[2]] if r['status']=='canceled')['orders_without_items']=='1'
    by_state={r['state']:r for r in rows[names[3]]}
    assert by_state['SP']['payments']=='2' and by_state['SP']['payment_value']=='20'
    assert by_state['RJ']['average_installments']=='0.00'  # zero is preserved, not silently changed
    assert sum(int(r['payments']) for r in rows[names[4]])==4  # 2017 payment remains in all-time split
    ratings={r['score']:r for r in rows[names[5]]}
    assert ratings['1']['orders']=='0' and ratings['1']['average_delivery_days']==''
    assert ratings['5']['orders']=='2' and ratings['5']['average_delivery_days']=='2.00'
    assert ratings['2']['late_percent']=='100.00'
    assert ratings['4']['average_delivery_days']==''
    print('PASS: SQL edge cases (split payments, two sellers, latest review, invalid dates, 499/500 threshold, empty score)')

if __name__=='__main__':main()
