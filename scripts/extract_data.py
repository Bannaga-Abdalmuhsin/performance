"""Convert the supplied XLSB and PBIX report scope into an auditable JSON import.

Standard library only. Never commit generated operational data to a public repo.
Usage: python scripts/extract_data.py source.xlsb report.pbix /private/output
For exact stored PBIX rows and all formulas use extract_powerbi.py instead.
"""
import contextlib, datetime as dt, gzip, hashlib, io, json, sys, zipfile, os, subprocess, tempfile
from pathlib import Path
from xlsb_reader import load_xlsb

def clean(x):
    if x is None or str(x).startswith('#ERR'): return None
    s = str(x).strip()
    return s or None

def date(x):
    if isinstance(x, (float,int)) and 30000 < x < 80000:
        v = dt.datetime(1899,12,30) + dt.timedelta(seconds=round(x*86400))
    elif isinstance(x,str):
        v = None
        for f in ('%d/%m/%Y %H:%M:%S','%d/%m/%Y %H:%M','%Y-%m-%d %H:%M:%S','%d/%m/%Y','%Y-%m-%d'):
            try: v=dt.datetime.strptime(x.strip(), f); break
            except ValueError: pass
        if v is None: return None
    else: return None
    return v.isoformat(timespec='seconds')+'+03:00'

def minutes(x):
    if isinstance(x,(float,int)) and x >= 0: return round(x*1440,6)
    return None

def report_profile(path):
    with zipfile.ZipFile(path) as z:
        layout=json.loads(z.read('Report/Layout').decode('utf-16-le'))
    section=next(s for s in layout['sections'] if s['displayName']=='Monthly Overview (SA)')
    filters=json.loads(section['filters'])
    root=next(f for f in filters if f['expression']['Column']['Property']=='Root Cause Details')
    vals=root['filter']['Where'][0]['Condition']['Not']['Expression']['In']['Values']
    exclusions=[v[0]['Literal']['Value'][1:-1] for v in vals]
    return {'name':'Power BI monthly scope','service_impact':'Outage','parent_blank':True,'excluded_root_causes':exclusions,
        'source_page':section['displayName'], 'source_file':Path(path).name,
        'duration_note':'Verified DAX: RestorationTime HHMMSS × 1440 minutes. Workbook precision may differ from stored PBIX values.'}

def convert(workbook, pbix, output):
    output=Path(output); output.mkdir(parents=True,exist_ok=True)
    with contextlib.redirect_stdout(io.StringIO()): sheets=load_xlsb(workbook)
    raw=sheets['SIR - ACES NOC.']
    header_row,header=next((row,r) for row,r in raw.items() if clean(r.get(1))=='Ticket Number')
    width=max(max(r,default=0) for r in raw.values())+1
    headers=[clean(header.get(i)) or f'Column_{i+1}' for i in range(width)]
    # Keep every original ticket candidate until the shared browser normalizer
    # can compare richness. Earlier filtering would lose richer later copies.
    candidates=[{**{headers[i]:r.get(i) for i in range(width)},'source_row':row+1}
        for row,r in raw.items() if row>header_row and clean(r.get(1))]
    meta={'source_workbook':Path(workbook).name,'source_sheet':'SIR - ACES NOC.','source_pbix':Path(pbix).name,
        'source_sha256':hashlib.sha256(Path(workbook).read_bytes()).hexdigest(),'profile':report_profile(pbix),
        'duration_dax_verified':True}
    with tempfile.TemporaryDirectory(prefix='cow-source-') as temporary:
        source=Path(temporary)/'source.json'
        source.write_text(json.dumps({'meta':meta,'records':candidates},ensure_ascii=False),encoding='utf-8')
        subprocess.run([os.environ.get('CODEX_PRIMARY_RUNTIME_NODE','node'),str(Path(__file__).with_name('prepare_import.mjs')),str(source),str(output.resolve())],check=True)
    with gzip.open(output/'performance-data.json.gz','rt',encoding='utf-8') as file:return json.load(file)

if __name__=='__main__':
    if len(sys.argv)!=4: raise SystemExit(__doc__)
    convert(*sys.argv[1:])
