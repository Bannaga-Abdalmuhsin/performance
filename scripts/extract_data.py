"""Convert the supplied XLSB and PBIX report scope into an auditable JSON import.

Standard library only. Never commit generated operational data to a public repo.
Usage: python scripts/extract_data.py source.xlsb report.pbix /private/output
For exact stored PBIX rows and all formulas use extract_powerbi.py instead.
"""
import contextlib, csv, datetime as dt, gzip, hashlib, io, json, re, sys, zipfile
from collections import Counter, defaultdict
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
    raw=sheets['SIR - ACES NOC.']; groups=defaultdict(list)
    for row,r in raw.items():
        ticket=clean(r.get(1)); site=clean(r.get(16))
        if ticket and re.fullmatch(r'(PR|PMR|TT)\d+',ticket): groups[(ticket,clean(r.get(11)),site,clean(r.get(19)))].append((row,r))
    quality=Counter(); records=[]; duplicate_log=[]
    for (ticket,severity,site,district), values in groups.items():
        # Power Query deduplicates Ticket+Severity+SiteID+District. Retain the first
        # source occurrence deterministically and log the removed occurrences.
        row,r=values[0]
        source_key=ticket+(severity or '')+(site or '')+(district or '')
        if len(values)>1: duplicate_log.append({'ticket_number':ticket,'site_id':site,'retained_row':row+1,'discarded_rows':[i+1 for i,_ in values if i!=row]})
        created=date(r.get(25)); cleared=date(r.get(26)); referred=date(r.get(27))
        duration=minutes(r.get(29)); sla=minutes(r.get(30)); issues=[]
        if not created: quality['missing_created_date']+=1; issues.append('Missing create date')
        if cleared and created and cleared<created: quality['cleared_before_created']+=1; issues.append('Cleared before create date')
        if cleared and referred and cleared<referred: quality['cleared_before_referral']+=1; issues.append('Cleared before referral')
        if duration is None: quality['missing_recorded_duration']+=1
        if not cleared: quality['missing_cleared_date']+=1
        if duration is not None and cleared and created:
            derived=(dt.datetime.fromisoformat(cleared)-dt.datetime.fromisoformat(created)).total_seconds()/60
            if abs(duration-derived)>1/30: quality['duration_differs_from_create_to_clear']+=1; issues.append('Recorded duration differs from create-to-clear')
        exceeded=clean(r.get(33)); breached={'yes':True,'no':False}.get((exceeded or '').lower())
        exclusion=clean(r.get(53)); excluded=(exclusion or '').lower() in ('exclude','excluded')
        region=(clean(r.get(18)) or 'Unknown').title()
        impact={'outage':'Outage','no':'No impact','degraded':'Degraded'}.get((clean(r.get(21)) or '').lower(),'Unknown')
        records.append({'id':'pbi:'+source_key,'source_key':source_key,'restoration_days':r.get(29) if isinstance(r.get(29),(int,float)) else None,'duration_text':clean(r.get(28)),'duration_dax_minutes':None,
            'ticket_number':ticket,'site_id':site,'site_name':clean(r.get(17)),
            'region':region,'district':(clean(r.get(19)) or 'Unknown').title(),'city':clean(r.get(20)),
            'vendor':clean(r.get(5)) or 'Unknown','severity':clean(r.get(11)) or 'Unknown',
            'service_impact':impact,'site_label':clean(r.get(45)) or 'Unknown',
            'created_at':created,'created_date':created[:10] if created else None,'cleared_at':cleared,'referred_at':referred,
            'impact_start':date(r.get(22)),'impact_finish':date(r.get(23)),
            'duration_minutes':duration,'sla_minutes':sla if sla and sla>0 else None,
            'sla_breached':breached,'sla_excluded':excluded,'exclusion_reason':clean(r.get(47)),
            'parent_tt':clean(r.get(36)),'root_cause':clean(r.get(41)) or 'Unknown',
            'repair_details':clean(r.get(37)),'cleared_group':clean(r.get(15)),
            'source_row':row+1,'quality_flags':issues})
    records.sort(key=lambda r:(r['created_date'] or '',r['id']))
    dates=[r['created_date'] for r in records if r['created_date']]
    profile=report_profile(pbix)
    meta={'source_workbook':Path(workbook).name,'source_sheet':'SIR - ACES NOC.','source_pbix':Path(pbix).name,
        'source_sha256':hashlib.sha256(Path(workbook).read_bytes()).hexdigest(),
        'record_count':len(records),'raw_record_count':sum(map(len,groups.values())),
        'duplicates_removed':sum(len(v)-1 for v in groups.values()),'min_date':min(dates),'max_date':max(dates),
        'extracted_at':dt.datetime.now(dt.timezone.utc).isoformat(),'timezone':'Asia/Riyadh',
        'quality':dict(quality),'profile':profile,'format_version':2,'grain':'Ticket Number + Severity + SiteID + District'}
    dataset={'meta':meta,'records':records}
    with gzip.open(output/'performance-data.json.gz','wt',encoding='utf-8',compresslevel=9) as f: json.dump(dataset,f,ensure_ascii=False,separators=(',',':'))
    (output/'metadata.json').write_text(json.dumps(meta,indent=2))
    (output/'duplicates.json').write_text(json.dumps(duplicate_log,indent=2))
    with (output/'performance-tickets.csv').open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=list(records[0])); writer.writeheader()
        for r in records: writer.writerow({**r,'quality_flags':json.dumps(r['quality_flags'])})
    # NDJSON allows a bounded-memory database import without loading the whole source workbook.
    with (output/'performance-tickets.ndjson').open('w',encoding='utf-8') as f:
        for r in records: f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
    (output/'report-profile.json').write_text(json.dumps(profile,indent=2))
    print(json.dumps({k:v for k,v in meta.items() if k!='profile'},indent=2))
    return dataset

if __name__=='__main__':
    if len(sys.argv)!=4: raise SystemExit(__doc__)
    convert(*sys.argv[1:])
