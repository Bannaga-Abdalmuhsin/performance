# stc COW performance · Use case 04

A private operational review platform for ACES / stc COW performance, with six chart dashboards backed by completed cumulative Supabase snapshots.

The six dashboards analyze **all retained records** in the selected SA/NSA impact group, review period and user filters. Historical page criteria, parent-ticket exclusions, root-cause exclusions, category thresholds and top-N visual filters do not affect live analysis. All category totals reconcile with the selected ticket scope. The interface has no source-tool branding, criteria selector, formula pages or data administration controls.

| Dashboard | Comparison | Impact scope |
|---|---|---|
| Weekly Overview (SA) | Selected Sunday-based week vs previous two weeks | Outage |
| Weekly Overview (NSA) | Selected week vs previous two weeks | Every impact except Outage |
| Monthly Overview (SA) | Selected review month vs previous two months | Outage |
| MoM Y | Same month across three years | Outage |
| WoW Y | Same week number across three years | Outage |
| YoY | Matching YTD coverage through the review month | Outage |

**Export PDF** prepares a separate, branded A4 performance report for the active analysis and filter selection. Choose **Save as PDF** in the native print dialog. The report includes an executive assessment, exact period/date/filter scope, comparison metrics, root cause and district charts, restoration duration and within-period patterns, regional and operational breakdowns, COW priorities, and existing review notes. Reports use the complete selected scope; explicitly labelled top-eight summaries keep printed charts legible. Long notes paginate onto additional pages. Export does not navigate away from the selected dashboard.

Restoration hours use recorded minutes divided by 60; means use valid recorded durations. SLA compliance uses recorded outcomes and explicit exemptions. Zero and missing values remain distinct. Sunday-based weeks and matched month/year comparisons retain their calendar rules. NSA source coverage and its default latest week are determined independently of the later SA cutoff.

Current cumulative imports keep **one original row per ticket number**, as requested. Ticket numbers are trimmed, normalized to uppercase and validated as PR/PMR/TT followed by digits. The row with the most populated original business fields wins. Equal field counts prefer more text characters; exact ties retain the first source occurrence. Zero and false are populated; blanks, N/A placeholders and spreadsheet errors are not. Rows are selected whole, never merged. All original business fields are stored in `performance_tickets.source_data`; `deduplication` records retained/removed source row numbers and scores. Invalid ticket numbers/create dates remain in `performance_imports.metadata.quarantined_rows` for review and are excluded from charts.

This replaces the original Power Query key of Ticket Number + Severity + SiteID + District. The extracted Power BI audit still records the original formulas and model anomalies. Live analysis applies the selected impact group, period and operational filters to the cleaned dataset. Historical page and visual filters are retained only in source audit files and are not fetched by the application.

The saved model has no relationships. Some original formulas also subtract an unexplained four tickets, select an entire prior year at week 1/January, omit August 31, or use week 12 for volume and week 22 for duration. Live comparisons explicitly filter Create Date, use the selected periods with correct year boundaries, include the full selected month, and show observed row counts without the fixed subtraction. The original expressions and documented differences remain in the retained source audit for internal reference. Historical Eid filters and frozen slicer dates are audited rather than carried into future periods.

Weeks implement DAX `WEEKNUM(Date,1)`: Sunday starts, January 1 belongs to week 1, and weeks at year boundaries may be short. MoM Y aligns days when the uploaded month is partial; YoY aligns YTD cutoff dates, including leap-year boundaries. Other partial periods are labelled. Outside-coverage periods have no comparison. Change is `(current - previous) / previous * 100`; a positive current against zero shows +100%, both zero shows 0%, following the report's weekly rule.

The source's `Exceed SLA` Yes/No and explicit SLA exemption determine the separately labelled source SLA compliance. The original “Outperform SLA %” visuals actually reference ticket-change measures. Stored `Duration dax (Min)`, `SLA OUTAGES` and `SLA POWER` have no values in this PBIX. Their expressions are preserved in the audit. Network availability requires historical on-air inventory and is not inferred from ticket counts.

## Account settings and data administration

**User settings** contains the signed-in user’s email, display name, current dashboard role, password change and sign-out. It updates the existing Supabase Auth account. Display names are profile data and never control authorization. Data uploads and connection configuration are not available in the dashboard UI; manage cumulative snapshots through the database or the included import CLI.

## Upload future cumulative data

1. GitHub Pages opens a separate sign-in screen. Use the email and password for an existing Supabase Auth account approved in `performance_members`. The dashboard, navigation and ticket actions remain hidden and inactive until access and the complete dataset are verified; signing out returns to this screen and clears loaded rows. Existing sessions are revalidated before opening the dashboard. GitHub account credentials are separate. The project URL and browser publishable key are configured; bundled connection settings take priority over stale browser settings. RLS still requires an approved account, and secret/service-role keys are rejected.
2. Use the database or import CLI to upload the **complete cumulative file** as CSV, JSON or JSON.GZ. Original source CSV headers or canonical database column names are accepted. The uploader selects the richest original row for each ticket. Review quarantined rows and duplicate counts, then save to PostgreSQL.
3. The uploader creates a pending import, writes its rows, then calls `performance_complete_import(batch_id, expected_count)`. PostgreSQL validates the count, ticket identities and absence of duplicate ticket numbers before publishing atomically. Pending/failed uploads leave the previous completed snapshot live.
4. Every visible connected dashboard checks for a newer completed snapshot every 30 seconds and on returning to the tab. A new snapshot refreshes all six views. Filters are preserved; the default latest-period selection advances when newer coverage arrives.

Completed snapshots are immutable. Corrections require a new cumulative upload. Older snapshots remain available in Supabase for audit. This is cumulative replacement, not an incremental append feed. Each dataset load is pinned to one import ID and checks its expected row count before replacing the UI state.

`public.performance_current_tickets` exposes only the latest completed dataset for SQL and Table Editor review, with underlying RLS enforced. Use this view for current-data queries; the base table also contains historical snapshots.

### Prepare PBIX or XLSB

For PBIX, install the optional parser in your own Python environment and extract locally:

```sh
python -m pip install -r requirements-pbix.txt
python scripts/extract_powerbi.py /private/report.pbix /private/output
```

For the original XLSB layout, the included standard-library reader requires Python and Node 18+ without extra packages:

```sh
python scripts/extract_data.py /private/source.xlsb /private/report.pbix /private/output
```

Both produce `performance-data.json.gz` and `performance-tickets.csv`. PBIX extraction preserves the stored model for the formula audit; browser and CLI imports then apply the requested ticket-only richness rule. XLSB extraction calls the same normalizer directly. Workbook precision and row coverage can differ from the PBIX. Two-digit-year dates exported by this PBIX are US month-first; original four-digit-year dates are day-first. Source dates are interpreted explicitly in Asia/Riyadh, not the browser's timezone.

To upload the prepared dataset without the web interface:

```sh
python scripts/import_postgres.py /private/output/performance-data.json.gz
```

The CLI prompts for an approved account and publishable key; credentials are never written to source files. For direct SQL/Table Editor imports, first create a pending `performance_imports` row, include its `import_id` on every CSV row, and call `performance_complete_import` with the expected count after all rows have been uploaded. Direct edits to completed data are rejected.

## Database and access

Apply the migrations `database/001_performance.sql` through `database/004_current_performance.sql` in order. They only affect the `performance_*` objects and retain existing unrelated project data. The migrations were applied to the supplied project. RLS controls every exposed performance table. Anonymous users have no performance-table grants. Viewers read completed snapshots; analysts/admins publish new ones. Browser users cannot assign membership or delete records.

An administrator must map the intended existing Auth account to `performance_members`; no account identity is guessed. The bootstrap statement is at the end of migration 001. No permanent membership was assigned during extraction. The native site remains owner-private, and its protected snapshot allows the owner to review the decoded baseline while database access is configured.

## Validation and source handling

```sh
npm run check
npm test
```

The project has no JavaScript dependencies or build step. Tests cover all six report modes, period/year/leap boundaries, inclusion of all records despite retired page and visual criteria, PDF scope and print-dialog preparation, duration bands, zero/missing values, raw CSV normalization, escaping, immutable snapshot selection, import failure/count handling, and all UI renderers in a minimal DOM harness.

The original source extraction was reconciled across 870 historical weekly/monthly aggregates. Live analysis now includes all retained records within the selected impact, period and filters. Record IDs, dates, duration counts and totals were also checked. Database role tests verified viewer read restrictions, analyst publication, count validation, immutable completed snapshots, server-side duration conversion and Riyadh dates, then rolled back. These are functional/data checks; a full browser layout and live user sign-in session have not been tested in this environment.

`dist/private-snapshot.json.gz` exists only in the owner-private native Site source. It must never be pushed to the public GitHub repository or GitHub Pages. The public `dist/config.js` has `privateSnapshot: null` and the browser publishable key; it never contains a secret or service-role key. Raw files, extracted records, temporary payloads and import containers must remain outside public source control.

The public repository contains a formula-audit placeholder. The full extracted audit and operational source snapshot are available only in the owner-private hosted Site.

Weekly NSA opens the latest week containing an eligible NSA record, independently of the overall SA upload cutoff. The subtitle shows the latest NSA record date. Explicitly selected periods remain selected; **Latest available week** returns to the newest available week and follows future completed uploads.

**Review week:** All weeks (full year) selects January 1 through December 31 of the review year in weekly SA, weekly NSA and WoW Y. Comparisons use the two prior full calendar years; current partial source coverage remains labelled. Changing the year preserves All weeks. PDF exports use the same annual selection. Vendor filters contain Nokia, Ericsson, Huawei and Others; every other label, including NSN and missing values, belongs to Others. Source database values remain intact. Chart cards display their main titles without subtitles, and the sidebar source status is hidden while automatic refresh continues.
