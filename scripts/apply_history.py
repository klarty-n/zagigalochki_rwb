#!/usr/bin/env python3
"""Apply historical schema + mart atomically. Default: Neon via ignored owner URL.
--local uses psql and DATABASE_URL. Access grants and rollback tests run afterwards.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--local',action='store_true');a=p.parse_args()
    sql='\\set ON_ERROR_STOP on\nBEGIN;\n'
    for name in ['model/01_schema.sql','model/03_mart.sql']:
        sql+='\n'.join(l for l in (ROOT/name).read_text().splitlines() if l.strip() not in ['BEGIN;','COMMIT;','\\set ON_ERROR_STOP on'])+'\n'
    sql+='COMMIT;\n'
    with tempfile.TemporaryDirectory(prefix='marketplace-history-') as d:
        path=Path(d)/'apply.sql';path.write_text(sql)
        for file in [path,ROOT/'deploy/dashboard_access.sql',ROOT/'checks/history.sql',ROOT/'checks/mart.sql']:
            if a.local:
                cmd=['psql','-X',os.environ.get('DATABASE_URL','postgresql://hack:hack@127.0.0.1:5433/marketplace'),'-v','ON_ERROR_STOP=1','-f',str(file)]
            else:cmd=[sys.executable,str(ROOT/'deploy/cloud_psql.py'),'--file',str(file)]
            subprocess.run(cmd,cwd=ROOT,check=True)
    print('PASS: historical schema, marts, access and rollback scenarios')
if __name__=='__main__':main()
