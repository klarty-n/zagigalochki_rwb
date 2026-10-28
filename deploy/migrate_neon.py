#!/usr/bin/env python3
"""One-time copy of an existing Docker PostgreSQL 16 database to an EMPTY Neon database.
Credentials are read from an ignored file, never placed in command arguments.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit,unquote

ROOT=Path(__file__).resolve().parents[1]
TABLES=['core.orders','core.order_items','core.customers','core.products','core.sellers',
        'core.categories','core.order_payments','core.order_reviews',
        'raw.orders','raw.order_items','raw.customers','raw.products','raw.sellers',
        'raw.product_category_translation','raw.order_payments','raw.order_reviews']
FINGERPRINT='SELECT json_build_object('+','.join("'%s',(SELECT count(*) FROM %s)"%(t,t) for t in TABLES)+",'price',(SELECT sum(price) FROM core.order_items),'freight',(SELECT sum(freight_value) FROM core.order_items),'payment',(SELECT sum(payment_value) FROM core.order_payments))::text"

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target-file',default=str(ROOT/'deploy/secrets/neon-owner.url'))
    p.add_argument('--source-container',default='hack_postgres')
    args=p.parse_args()
    uri=urlsplit(Path(args.target_file).read_text().strip())
    if not uri.hostname or not uri.hostname.endswith('.neon.tech') or '-pooler.' in uri.hostname:
        raise SystemExit('Target must be a direct Neon host, not localhost or a pooler.')
    if not uri.path.strip('/') or not uri.password or '*' in uri.password:
        raise SystemExit('Incomplete target credentials.')
    env={**os.environ,'PGHOST':uri.hostname,'PGPORT':str(uri.port or 5432),
         'PGDATABASE':unquote(uri.path.lstrip('/')),'PGUSER':unquote(uri.username),
         'PGPASSWORD':unquote(uri.password),'PGSSLMODE':'verify-full',
         'PGSSLROOTCERT':'/etc/ssl/cert.pem','PGCONNECT_TIMEOUT':'20'}
    src=['docker','exec','-i',args.source_container]
    dst=['docker','exec','-i']
    for key in ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT']:
        dst+=['-e',key]
    dst+=[args.source_container]
    def sql(q,remote=False):
        cmd=(dst if remote else src)+['psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1']
        if not remote:cmd+=['-U','hack','-d','marketplace']
        r=subprocess.run(cmd+['-c',q],env=env if remote else None,text=True,capture_output=True,check=True)
        return r.stdout.strip()
    version=int(sql('SHOW server_version_num'))
    if version//10000!=16:raise SystemExit('Expected source PostgreSQL 16.')
    if int(sql('SHOW server_version_num',True))//10000<16:raise SystemExit('Target is older than source.')
    occupied=sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('raw','core','mart','etl')",True)
    if int(occupied):raise SystemExit('Target already has application objects: refusing to overwrite.')
    before=json.loads(sql(FINGERPRINT))
    backup=ROOT/'deploy/backups'/('neon-transfer-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.dump')
    backup.parent.mkdir(exist_ok=True,parents=True)
    fd=os.open(backup,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    print('Creating a PostgreSQL 16 archive...',flush=True)
    with os.fdopen(fd,'wb') as stream:
        subprocess.run(src+['pg_dump','-U','hack','-d','marketplace','-Fc','--no-owner','--no-acl'],stdout=stream,check=True)
    if json.loads(sql(FINGERPRINT))!=before:raise SystemExit('Source changed during export; rerun against a stable source.')
    print('Restoring into empty Neon database in one transaction...',flush=True)
    with backup.open('rb') as stream:
        subprocess.run(dst+['pg_restore','--dbname',env['PGDATABASE'],'--no-owner','--no-acl','--exit-on-error','--single-transaction'],
                       env=env,stdin=stream,check=True)
    after=json.loads(sql(FINGERPRINT,True))
    if before!=after:raise SystemExit('Restored data differs from source; do not switch clients.')
    revenue=sql("SELECT count(*),sum(revenue) FROM mart.monthly_sales WHERE month>=date '2016-09-01' AND month<date '2018-09-01'",True)
    if revenue!='24|13221498.11':raise SystemExit('Block A revenue differs from expected baseline.')
    report={'status':'passed','target_host':uri.hostname,'database':env['PGDATABASE'],
            'source_container':args.source_container,'checked_at_utc':datetime.now(timezone.utc).isoformat(),
            'row_counts_and_sums':after,'monthly_control':revenue,
            'dump_sha256':hashlib.sha256(backup.read_bytes()).hexdigest()}
    (ROOT/'reports/cloud-migration.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('PASS: all 16 table counts and 3 monetary totals match. Monthly revenue:',revenue,flush=True)

if __name__=='__main__':main()
