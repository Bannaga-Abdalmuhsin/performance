// Normalize raw source rows through exactly the same rules as browser uploads.
// Input: {meta, records}; output directory must be private, outside a public repo.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {normalizeRecords,FIELDS,DEDUPLICATION_POLICY,exportCSV} from '../dist/core.mjs';
const [inputFile,outputDirectory]=process.argv.slice(2);
if(!inputFile||!outputDirectory)throw new Error('Usage: node scripts/prepare_import.mjs input.json /private/output');
const bytes=await fs.readFile(inputFile),doc=JSON.parse((inputFile.endsWith('.gz')?zlib.gunzipSync(bytes):bytes).toString('utf8')),result=normalizeRecords(doc.records);
if(!result.records.length)throw new Error('No valid dated tickets remain.');
const records=result.records.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),dates=records.map(r=>r.created_date).sort();
const quality={missing_recorded_duration:records.filter(r=>r.duration_minutes===null).length,missing_cleared_date:records.filter(r=>!r.cleared_at).length,cleared_before_created:records.filter(r=>r.quality_flags.includes('Cleared before create date')).length,cleared_before_referral:records.filter(r=>r.quality_flags.includes('Cleared before referral')).length,duration_differs_from_create_to_clear:records.filter(r=>r.quality_flags.includes('Recorded duration differs from create-to-clear')).length};
const prepared=doc.meta?.deduplication_policy===DEDUPLICATION_POLICY&&doc.meta?.record_count===doc.records.length;
const meta={...doc.meta,format_version:3,grain:'Ticket Number',deduplication_policy:DEDUPLICATION_POLICY,deduplication_rule:'Most populated original business fields; then most text characters; then first source occurrence. Zero and false are populated. Blank, N/A and spreadsheet error cells are not.',raw_record_count:prepared?doc.meta.raw_record_count:doc.records.length,record_count:records.length,duplicates_removed:(prepared?doc.meta.duplicates_removed||0:0)+result.duplicates,duplicate_ticket_groups:records.filter(r=>r.deduplication).length,quarantined_record_count:(prepared?doc.meta.quarantined_record_count||0:0)+result.rejected.length,quarantined_rows:[...(prepared?doc.meta.quarantined_rows||[]:[]),...result.rejected],min_date:dates[0],max_date:dates.at(-1),extracted_at:new Date().toISOString(),timezone:'Asia/Riyadh',quality};
const controls={raw_rows:meta.raw_record_count,retained:records.length,duplicates_removed:meta.duplicates_removed,quarantined:meta.quarantined_record_count,unique_tickets:new Set(records.map(r=>r.ticket_number)).size,min_date:meta.min_date,max_date:meta.max_date,duration_minutes:records.reduce((n,r)=>n+(r.duration_minutes??0),0),id_md5:crypto.createHash('md5').update(records.map(r=>r.id).join('|')).digest('hex'),source_rows_md5:crypto.createHash('md5').update(records.map(r=>r.ticket_number+':'+r.source_row).join('|')).digest('hex')};
if(controls.raw_rows!==controls.retained+controls.duplicates_removed+controls.quarantined)throw new Error('Row reconciliation failed.');
await fs.mkdir(outputDirectory,{recursive:true});
await fs.writeFile(path.join(outputDirectory,'performance-data.json.gz'),zlib.gzipSync(JSON.stringify({meta,records}),{level:9}));
// Raw source columns stay in Supabase, rather than being sent to every chart.
const baselineMeta={...meta};delete baselineMeta.quarantined_rows;
await fs.writeFile(path.join(outputDirectory,'private-snapshot.json.gz'),zlib.gzipSync(JSON.stringify({meta:baselineMeta,records:records.map(r=>Object.fromEntries(FIELDS.map(k=>[k,r[k]])))}),{level:9}));
await fs.writeFile(path.join(outputDirectory,'metadata.json'),JSON.stringify(meta,null,2));
await fs.writeFile(path.join(outputDirectory,'performance-tickets.csv'),exportCSV(records));
await fs.writeFile(path.join(outputDirectory,'controls.json'),JSON.stringify(controls,null,2));
console.log(JSON.stringify(controls));
