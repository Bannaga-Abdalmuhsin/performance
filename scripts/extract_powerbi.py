"""Read every PBIX page, DAX expression, M query and stored fact row.

Requires the optional packages in requirements-pbix.txt. Run locally:
  python scripts/extract_powerbi.py report.pbix /private/output
Never commit the output dataset to the public source repository.
"""
import csv, datetime as dt, gzip, hashlib, json, re, sys, zipfile
from collections import Counter
from pathlib import Path
from pbixray import PBIXRay

PAGE_IDS = {'Weekly Overview (SA)':'weekly-sa','Weekly Overview (NSA)':'weekly-nsa',
            'Monthly Overview (SA)':'overview','MOM Y':'mom-y','WOW Y':'wow-y'}

def literal(value):
    if value == 'null': return None
    if value.startswith("'"): return value[1:-1].replace("''", "'")
    if re.fullmatch(r'-?\d+[LD]?',value): return int(value.rstrip('LD'))
    return value

def conditions(filters):
    result=[]
    for f in filters:
        for w in (f.get('filter') or {}).get('Where',[]):
            c=w.get('Condition',{}); inverted='Not' in c
            c=c.get('Not',{}).get('Expression',c)
            if 'In' in c:
                x=c['In']; expr=x.get('Expressions',[{}])[0]
                if 'Column' in expr and 'Values' in x:
                    result.append({'field':expr['Column']['Property'],'exclude':inverted,
                                   'values':[literal(v[0]['Literal']['Value']) for v in x['Values']]})
    return result

def page_profile(page):
    rules=conditions(json.loads(page.get('filters') or '[]'))
    return {'id':PAGE_IDS[page['displayName']],'name':page['displayName'],
        'impact_mode':'NSA' if page['displayName'].endswith('(NSA)') else 'SA',
        'parent_blank':True,'excluded_root_causes':list(dict.fromkeys(
            v for x in rules if x['field']=='Root Cause Details' and x['exclude'] for v in x['values'])),
        'rules':rules}

def visual_profiles(page):
    """Separate enduring visual filters from saved date selections/legacy dates."""
    fields={'Root Cause Details':'root_cause','District':'district','Site Label':'site_label',
            'Severity':'severity','Duration Criteria':'duration_bucket'}
    result={}
    for v in page.get('visualContainers',[]):
        sv=json.loads(v.get('config')or'{}').get('singleVisual',{})
        if sv.get('visualType')not in ('lineClusteredColumnComboChart','clusteredBarChart'):continue
        query=json.loads(v.get('query')or'{}');selects=[]
        for command in query.get('Commands',[]):selects+=command.get('SemanticQueryDataShapeCommand',{}).get('Query',{}).get('Select',[])
        columns=[x['Column']['Property']for x in selects if 'Column'in x and x['Column']['Property']in fields]
        if not columns:continue
        field=fields[columns[0]]
        if field in result:continue
        filters=json.loads(v.get('filters')or'[]');row_rules=conditions(filters);group_rules=[];notes=[];top_n=None
        for f in filters:
            for w in (f.get('filter')or{}).get('Where',[]):
                c=w.get('Condition',{});negated='Not'in c;c=c.get('Not',{}).get('Expression',c)
                if 'Comparison'in c:
                    x=c['Comparison'];left=x.get('Left',{});value=literal(x.get('Right',{}).get('Literal',{}).get('Value','null'))
                    if 'Measure'in left:
                        measure=left['Measure']['Property'];period={'This_Week_Total':0,'Last_Week_Total':1,'Last_2Week_Total':2,'Last_Month_Total SA':0,'Last_2Month_Total SA':1,"#Total Ticket's":0}.get(measure)
                        if re.match(r'^Aug Y\d+$',measure):period=0
                        if period is not None:group_rules.append({'period':period,'kind':x['ComparisonKind'],'value':value,'not':negated})
                        else:notes.append('Legacy filter '+measure+' is recorded in the audit, not applied to rolling comparisons.')
                    elif 'Column'in left and value is None:
                        row_rules.append({'field':left['Column']['Property'],'exclude':negated,'values':[None]})
                if 'Contains'in c:
                    x=c['Contains'];row_rules.append({'field':x['Left']['Column']['Property'],'exclude':negated,'contains':literal(x['Right']['Literal']['Value'])})
            if f.get('type')=='TopN':
                for source in f['filter'].get('From',[]):
                    q=source.get('Expression',{}).get('Subquery',{}).get('Query',{})
                    if q.get('Top'):top_n=q['Top'];notes.append('Top '+str(top_n)+' by tickets across the loaded source, under the page criteria.')
        result[field]={'row_rules':row_rules,'group_rules':group_rules,'top_n':top_n,'notes':notes}
    return result

def clean(value):
    return None if value is None or str(value).startswith('#ERR') else str(value).strip() or None

def date(value):
    if value is None or value=='': return None
    if isinstance(value,(int,float)):
        d=dt.datetime(1899,12,30)+dt.timedelta(seconds=round(value*86400))
    else:
        s=str(value).strip();d=None
        # This PBIX stores older dates in US two-digit-year format and newer
        # dates in day-first four-digit-year format. Never guess between them.
        for f in ('%m/%d/%y %H:%M','%m/%d/%y %H:%M:%S','%d/%m/%Y %H:%M:%S',
                  '%d/%m/%Y %H:%M','%d/%m/%Y','%d-%b-%y','%d-%b-%Y','%Y-%m-%dT%H:%M:%S.%f','%Y-%m-%dT%H:%M:%S','%Y-%m-%d'):
            try: d=dt.datetime.strptime(s,f);break
            except ValueError: pass
        if d is None: raise ValueError('Unrecognized source date: '+s)
    return d.isoformat(timespec='seconds')+'+03:00'

def legacy_minutes(text):
    if not text:return None
    s=re.sub(r'Days|Hrs|Mins|Sec|:| ', '',text)
    if len(s)!=8 or not s.isdigit():return None
    d,h,m,s=map(int,(s[:2],s[2:4],s[4:6],s[6:]))
    return d*1440+h*60+m+s/60

def extract(pbix,output):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(pbix) as z:layout=json.loads(z.read('Report/Layout').decode('utf-16-le'))
    profiles={PAGE_IDS[p['displayName']]:page_profile(p) for p in layout['sections']}
    for page in layout['sections']:profiles[PAGE_IDS[page['displayName']]]['visuals']=visual_profiles(page)
    profiles['yoy']={**profiles['overview'],'id':'yoy','name':'YoY','source_page':'Monthly Overview (SA)'}
    pages=[]
    with PBIXRay(pbix) as model:
        def rows(name):return json.loads(getattr(model,name).to_json(orient='records',date_format='iso'))
        measures=rows('dax_measures'); columns=rows('dax_columns'); tables=rows('dax_tables')
        power_query=rows('power_query'); relationships=rows('relationships')
        fact=model.get_table('Outages & power')
        raw=json.loads(fact.to_json(orient='records',date_format='iso'))
        calendar=json.loads(model.get_table('CALENDAR').to_json(orient='records',date_format='iso'))
    for page in layout['sections']:
        visuals=[]
        for v in page.get('visualContainers',[]):
            config=json.loads(v.get('config') or '{}');sv=config.get('singleVisual',{})
            query=json.loads(v.get('query') or '{}')
            selects=[];where=[]
            for cmd in query.get('Commands',[]):
                q=cmd.get('SemanticQueryDataShapeCommand',{}).get('Query',{})
                selects+=q.get('Select',[]);where+=q.get('Where',[])
            title=sv.get('vcObjects',{}).get('title',[{}])[0].get('properties',{}).get('text',{}).get('expr',{}).get('Literal',{}).get('Value',"''")
            visuals.append({'id':config.get('name'),'type':sv.get('visualType'),'title':literal(title),
                'select':selects,'where':where,'visual_filters':json.loads(v.get('filters')or'[]'),
                'slicer':sv.get('objects',{}) if sv.get('visualType')=='slicer' else None})
        pages.append({'id':PAGE_IDS[page['displayName']],'name':page['displayName'],
                      'profile':profiles[PAGE_IDS[page['displayName']]],'visuals':visuals})
    audit={'source_file':Path(pbix).name,'source_sha256':hashlib.sha256(Path(pbix).read_bytes()).hexdigest(),
        'page_count':len(pages),'measure_count':len(measures),'calculated_column_count':len(columns),
        'calculated_table_count':len(tables),'pages':pages,'measures':measures,'calculated_columns':columns,
        'calculated_tables':tables,'power_query':power_query,'relationships':relationships,
        'calendar':{'first_date':calendar[0]['Date'],'last_date':calendar[-1]['Date'],'week_rule':'WEEKNUM(Date,1): Sunday; January 1 is in week 1'},
        'findings':[
          'No model relationships are stored in this PBIX. Web date filtering explicitly uses Create Date in Asia/Riyadh.',
          "#Total Ticket's = 0 + COUNTROWS('Outages & power'); it is not DISTINCTCOUNT.",
          'Power Query deduplication key concatenates Ticket Number, Severity, SiteID and District.',
          'Last_Month_Total SA subtracts a fixed 4 from every result. Live KPIs show observed records; this unexplained adjustment is retained in the formula audit only.',
          'Several January/week-1 branches select the entire prior year; live comparisons use the adjacent calendar period.',
          'MOM Y measures select August 1–30, 2024–2026. The last day is omitted. Live MoM Y compares the selected full month across years.',
          'W22 Y26 ticket measure filters week 12, while its hours measure filters week 22. Live WoW Y uses one selected week for both.',
          'Outperform SLA % visuals actually reference ticket change measures. Live source SLA compliance is labelled separately.',
          'Saved visual category exclusions, count thresholds and the WoW Y top-10 root-cause filter are applied to comparison tables. Unrelated historical Eid filters and frozen date selections are retained in the audit, not applied to rolling periods.',
          'Stored Duration dax (Min), SLA OUTAGES and SLA POWER columns contain no values. Source Exceed SLA is retained separately.',
          'The stored fact table contains one repeated Power Query key (two rows). Both are preserved, with stable variant IDs and quality flags.',
          'YoY is a new sixth page using Monthly Overview (SA) scope and matching YTD coverage. It is not an original report page.'
        ]}
    records=[];quality=Counter();seen=set()
    key_counts=Counter(r.get('To remove the Duplicate ') for r in raw)
    for i,r in enumerate(raw):
        ticket=clean(r['Ticket Number']);site=clean(r['SiteID']);severity=clean(r['Severity'])or'Unknown';district=clean(r['District'])or'Unknown'
        key=r.get('To remove the Duplicate ') or ticket+severity+(site or '')+district
        duplicate=key_counts[key]>1
        if duplicate:key+='|variant:'+hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest()[:16]
        if key in seen:raise ValueError('Duplicate stored PBIX row')
        seen.add(key);created=date(r['Create Date']);cleared=date(r['Cleared Date']);referred=date(r['First Referred to ACES'])
        days=r['RestorationTime HHMMSS'];duration=None if days is None else days*1440;issues=[]
        if duplicate:issues.append('PBIX contains multiple rows for the Power Query key');quality['duplicate_model_key_rows']+=1
        if duration is None:quality['missing_recorded_duration']+=1
        if not cleared:quality['missing_cleared_date']+=1
        if cleared and created and cleared<created:quality['cleared_before_created']+=1;issues.append('Cleared before create date')
        if cleared and referred and cleared<referred:quality['cleared_before_referral']+=1;issues.append('Cleared before referral')
        if duration is not None and cleared and abs(duration-(dt.datetime.fromisoformat(cleared)-dt.datetime.fromisoformat(created)).total_seconds()/60)>1/30:
            quality['duration_differs_from_create_to_clear']+=1;issues.append('Recorded duration differs from create-to-clear')
        impact={'outage':'Outage','no':'No impact','degraded':'Degraded'}.get((clean(r['Service Impacted'])or'').lower(),'Unknown')
        breached={'yes':True,'no':False}.get((clean(r['Exceed SLA'])or'').lower())
        records.append({'id':'pbi:'+key,'ticket_number':ticket,'site_id':site,'site_name':clean(r['SiteName']),
          'region':(clean(r['Region'])or'Unknown').title(),'district':district.title(),'city':clean(r['City']),
          'vendor':clean(r['Vendor'])or'Unknown','severity':severity,'service_impact':impact,'site_label':clean(r['Site Label'])or'Unknown',
          'created_at':created,'created_date':created[:10],'cleared_at':cleared,'referred_at':referred,
          'impact_start':date(r['Service Impact Start ']),'impact_finish':date(r['Service Impact Finish']),
          'duration_minutes':duration,'sla_minutes':None,'sla_breached':breached,'exceeded_time':clean(r.get('Exceeded TIME')),
          'sla_excluded':(clean(r.get('SLA (Include / Excluded)'))or'').lower()in('exclude','excluded'),
          'exclusion_reason':clean(r['Exclusions']),'parent_tt':clean(r['Parent TT']),'root_cause':clean(r['Root Cause Details'])or'Unknown',
          'repair_details':clean(r['RepairDetails']),'cleared_group':clean(r['Cleared Group']),
          'source_row':i+1,'quality_flags':issues,'source_key':key,'restoration_days':days,
          'duration_text':clean(r['RestorationTime DDHHMMSS']),'duration_dax_minutes':legacy_minutes(r['RestorationTime DDHHMMSS'])})
        if duration is not None and abs(duration-r['New Duration Dax Min'])>1e-8:raise ValueError('Duration DAX mismatch')
    records.sort(key=lambda r:(r['created_date'],r['id']));dates=[r['created_date']for r in records]
    profile={**profiles['overview'],'source_page':'Monthly Overview (SA)','source_file':Path(pbix).name,
             'duration_note':'Verified from decoded DAX: RestorationTime HHMMSS × 1440 minutes.'}
    meta={'source_workbook':Path(pbix).name,'source_sheet':'Outages & power · decoded Power BI model',
          'source_pbix':Path(pbix).name,'source_sha256':audit['source_sha256'],'record_count':len(records),
          'raw_record_count':len(records),'duplicates_removed':0,'min_date':min(dates),'max_date':max(dates),
          'extracted_at':dt.datetime.now(dt.timezone.utc).isoformat(),'timezone':'Asia/Riyadh','quality':dict(quality),
          'profile':profile,'format_version':2,'grain':'Ticket Number + Severity + SiteID + District',
          'duplicate_model_key_rows':quality['duplicate_model_key_rows'],'model_unique_tickets':len({r['ticket_number']for r in records}),'duration_dax_verified':True}
    dataset={'meta':meta,'records':records}
    with gzip.open(output/'performance-data.json.gz','wt',compresslevel=9,encoding='utf-8')as f:json.dump(dataset,f,separators=(',',':'),ensure_ascii=False)
    with (output/'performance-tickets.csv').open('w',newline='',encoding='utf-8-sig')as f:
        w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader()
        for r in records:w.writerow({**r,'quality_flags':json.dumps(r['quality_flags'])})
    for name,obj in [('formula-audit',audit),('report-profiles',profiles),('report-profile',profile),('metadata',meta)]:
        (output/(name+'.json')).write_text(json.dumps(obj,indent=2,ensure_ascii=False))
    print(json.dumps({'rows':len(records),'tickets':meta['model_unique_tickets'],'min_date':min(dates),'max_date':max(dates),'measures':len(measures),'columns':len(columns),'pages':len(pages)},indent=2))
    return dataset,audit,profiles

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit(__doc__)
    extract(*sys.argv[1:])
