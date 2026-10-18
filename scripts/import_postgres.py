"""Import a prepared performance-data.json.gz using an approved Auth account.
Credentials are read interactively and kept only in memory. Standard library only.
"""
import base64, getpass, gzip, json, sys, urllib.request, urllib.error, urllib.parse
from pathlib import Path

PROJECT='https://vtsqazxhszbmwiswthgt.supabase.co'

def main(path):
    key=getpass.getpass('Publishable / anon API key: ').strip()
    valid=key.startswith('sb_publishable_')
    if not valid:
        try: valid=json.loads(base64.urlsafe_b64decode(key.split('.')[1]+'==='))['role']=='anon'
        except Exception: valid=False
    if not valid: raise SystemExit('Use the project publishable or anon key, not a secret or service-role key.')
    email=input('Approved Auth email: ').strip(); password=getpass.getpass('Password: ')
    token=None
    def request(path,method='GET',body=None,prefer=None):
        headers={'apikey':key,'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        if prefer: headers['Prefer']=prefer
        req=urllib.request.Request(PROJECT+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req,timeout=90) as response:
                data=response.read(); return json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            try: message=json.loads(error.read()).get('message',str(error))
            except Exception: message=str(error)
            raise RuntimeError(message) from None
    auth=request('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password});password=None;token=auth['access_token']
    members=request('/rest/v1/performance_members?select=role,active&user_id=eq.'+auth['user']['id'])
    if not members or not members[0]['active'] or members[0]['role'] not in ('admin','analyst'):raise SystemExit('The account needs an active performance admin or analyst role.')
    p=Path(path)
    with (gzip.open(p,'rt',encoding='utf-8') if p.suffix=='.gz' else p.open(encoding='utf-8')) as file: dataset=json.load(file)
    records=dataset['records'];meta=dataset['meta']
    if not records: raise SystemExit('No records to import.')
    if len({r['id'] for r in records})!=len(records):raise SystemExit('Duplicate IDs in import. Run the extraction script first.')
    [batch]=request('/rest/v1/performance_imports','POST',{'source_name':meta['source_workbook'],'source_sha256':meta.get('source_sha256'),'metadata':meta,'record_count':len(records),'min_date':meta['min_date'],'max_date':meta['max_date'],'status':'pending'},'return=representation')
    try:
        for i in range(0,len(records),500):
            chunk=[{**r,'import_id':batch['id']} for r in records[i:i+500]]
            request('/rest/v1/performance_tickets?on_conflict=import_id,id','POST',chunk,'resolution=merge-duplicates,return=minimal')
            print(f'Imported {min(i+500,len(records)):,} / {len(records):,}',flush=True)
        actual=request('/rest/v1/rpc/performance_complete_import','POST',{'batch_id':batch['id'],'expected_count':len(records)})
        print(f'Complete. PostgreSQL verified {actual:,} records. Import: {batch["id"]}')
    except Exception:
        try: request('/rest/v1/performance_imports?id=eq.'+batch['id'],'PATCH',{'status':'failed'})
        except Exception: pass
        raise
    finally:
        try: request('/auth/v1/logout','POST')
        except Exception: pass

if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit('Usage: python scripts/import_postgres.py /private/performance-data.json.gz')
    try: main(sys.argv[1])
    except (RuntimeError,KeyError,ValueError) as error:raise SystemExit(str(error))
