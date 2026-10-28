#!/usr/bin/env python3
"""Run SQL against Neon using a local ignored connection file and PostgreSQL 16 container."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit,unquote

ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--connection-file',default=str(ROOT/'deploy/secrets/neon-owner.url'))
    p.add_argument('--file')
    args=p.parse_args()
    u=urlsplit(Path(args.connection_file).read_text().strip())
    if not u.hostname or not u.hostname.endswith('.neon.tech'):raise SystemExit('Expected Neon host')
    env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGDATABASE':unquote(u.path.lstrip('/')),
         'PGUSER':unquote(u.username),'PGPASSWORD':unquote(u.password),'PGSSLMODE':'verify-full',
         'PGSSLROOTCERT':'/etc/ssl/cert.pem','PGCONNECT_TIMEOUT':'20'}
    cmd=['docker','exec','-i']
    for k in ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGCONNECT_TIMEOUT']:cmd+=['-e',k]
    cmd+=['hack_postgres','psql','-X','-w','-v','ON_ERROR_STOP=1','-P','pager=off']
    if args.file:
        with Path(args.file).open('rb') as stream:subprocess.run(cmd,env=env,stdin=stream,check=True)
    else:subprocess.run(cmd,env=env,stdin=sys.stdin.buffer,check=True)

if __name__=='__main__':main()
