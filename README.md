# stc COW performance · Use case 04

A private operational review platform for ACES / stc COW performance, with six dashboards backed by completed cumulative Supabase snapshots.

| Dashboard | Comparison | Source criteria |
|---|---|---|
| Weekly Overview (SA) | Selected Sunday-based week vs previous two weeks | Weekly SA page |
| Weekly Overview (NSA) | Selected week vs previous two weeks | Weekly NSA page: every impact except Outage |
| Monthly Overview (SA) | Selected review month vs previous two months | Monthly SA page |
| MoM Y | Same month across three years | MOM Y page |
| WoW Y | Same week number across three years | WOW Y page |
| YoY | Matching YTD coverage through the review month | New page using Monthly SA scope |

The public repository includes a pointer to the full formula audit in the private hosted workspace. Run the extractor for a separate private deployment; the original report metadata and decoded baseline are distributed only with the private Site.\n\nThe original PBIX contains five pages. `dist/formula-audit.json` records every page, visual query, visual filter, all 123 DAX measures, 88 calculated columns (15 business columns and 73 automatic date columns), 13 calculated tables and two Power Query expressions. Source folder paths are redacted. All raw operational rows stay outside the public GitHub repository.

## Criteria and model findings

Volume follows the decoded DAX `0 + COUNTROWS('Outages & power')`. It does not count distinct tickets. Distinct ticket numbers are displayed separately. Restoration minutes equal `RestorationTime HHMMSS * 1440`; hours equal minutes / 60. Missing and zero durations remain distinguishable. Duration bands follow the original thresholds: `<2hrs`, `02-04hrs`, `04-08hrs`, `08-24hrs`, and `>24hrs` (the last band includes exactly 1440 minutes).

Each page keeps its own service-impact, blank Parent TT and root-cause rules. Comparison tables also retain the saved category exclusions, count thresholds and WoW Y top-10 root-cause filter. The top-10 ranks tickets across the loaded source under the page criteria, matching the saved filter. KPI totals and the ticket register retain the complete page scope.

The Power Query deduplication key concatenates Ticket Number, Severity, SiteID and District. Raw CSV/XLSB ingestion keeps the first occurrence deterministically. The decoded PBIX itself contains one repeated key with two different rows; extraction preserves both with stable variant suffixes and flags the anomaly.

The saved model has no relationships. Some original formulas also subtract an unexplained four tickets, select an entire prior year at week 1/January, omit August 31, or use week 12 for volume and week 22 for duration. Live comparisons explicitly filter Create Date, use the selected periods with correct year boundaries, include the full selected month, and show observed row counts without the fixed subtraction. The original expressions remain available in **Formulas & criteria**, alongside each difference. Historical Eid filters and frozen slicer dates are audited rather than carried into future periods.

Weeks implement DAX `WEEKNUM(Date,1)`: Sunday starts, January 1 belongs to week 1, and weeks at year boundaries may be short. MoM Y aligns days when the uploaded month is partial; YoY aligns YTD cutoff dates, including leap-year boundaries. Other partial periods are labelled. Outside-coverage periods have no comparison. Change is `(current - previous) / previous * 100`; a positive current against zero shows +100%, both zero shows 0%, following the report's weekly rule.

The source's `Exceed SLA` Yes/No and explicit SLA exemption determine the separately labelled source SLA compliance. The original “Outperform SLA %” visuals actually reference ticket-change measures. Stored `Duration dax (Min)`, `SLA OUTAGES` and `SLA POWER` have no values in this PBIX. Their expressions are preserved in the audit. Network availability requires historical on-air inventory and is not inferred from ticket counts.

## Upload future cumulative data

1. Sign in under **Data & settings** with an existing Supabase Auth account approved in `performance_members`. The private hosted site has the project URL and publishable key configured. Public source distributions ask the user to supply the publishable key. Secret/service-role keys are rejected.
2. Upload the **complete cumulative file** as CSV, JSON or JSON.GZ. Original source CSV headers or canonical database column names are accepted. Review rejected rows and duplicate counts, then save to PostgreSQL.
3. The uploader creates a pending import, writes its rows, then calls `performance_complete_import(batch_id, expected_count)`. PostgreSQL validates the count and publishes the snapshot atomically. Pending/failed uploads leave the previous completed snapshot live.
4. Every visible connected dashboard checks for a newer completed snapshot every 30 seconds and on returning to the tab. A new snapshot refreshes all six views. Filters are preserved; the default latest-period selection advances when newer coverage arrives.

Completed snapshots are immutable. Corrections require a new cumulative upload. Older snapshots remain available in Supabase for audit. This is cumulative replacement, not an incremental append feed. Each dataset load is pinned to one import ID and checks its expected row count before replacing the UI state.

### Prepare PBIX or XLSB

For PBIX, install the optional parser in your own Python environment and extract locally:

```sh
python -m pip install -r requirements-pbix.txt
python scripts/extract_powerbi.py /private/report.pbix /private/output
```

For the original XLSB layout, the included standard-library reader requires no extra packages:

```sh
python scripts/extract_data.py /private/source.xlsb /private/report.pbix /private/output
```

Both produce `performance-data.json.gz` and `performance-tickets.csv`. PBIX extraction uses the stored model values and includes the full formula audit. XLSB extraction uses the workbook values; their precision and row coverage can differ from the PBIX. Two-digit-year dates exported by this PBIX are US month-first; original four-digit-year dates are day-first. Source dates are interpreted explicitly in Asia/Riyadh, not the browser's timezone.

To upload the prepared dataset without the web interface:

```sh
python scripts/import_postgres.py /private/output/performance-data.json.gz
```

The CLI prompts for an approved account and publishable key; credentials are never written to source files. For direct SQL/Table Editor imports, first create a pending `performance_imports` row, include its `import_id` on every CSV row, and call `performance_complete_import` with the expected count after all rows have been uploaded. Direct edits to completed data are rejected.

## Database and access

Apply `database/001_performance.sql` followed by `database/002_powerbi_versions.sql` in order. They only affect the `performance_*` objects and retain existing unrelated project data. The migrations were applied to the supplied project. RLS controls every exposed performance table. Anonymous users have no performance-table grants. Viewers read completed snapshots; analysts/admins publish new ones. Browser users cannot assign membership or delete records.

An administrator must map the intended existing Auth account to `performance_members`; no account identity is guessed. The bootstrap statement is at the end of migration 001. No permanent membership was assigned during extraction. The native site remains owner-private, and its protected snapshot allows the owner to review the decoded baseline while database access is configured.

## Validation and source handling

```sh
npm run check
npm test
```

The project has no JavaScript dependencies or build step. Tests cover all six report modes, period/year/leap boundaries, page and visual criteria, duration bands, zero/missing values, raw CSV normalization, escaping, immutable snapshot selection, import failure/count handling, and all UI renderers in a minimal DOM harness.

The decoded source was reconciled to the JavaScript engine and PostgreSQL across 870 weekly/monthly page-scope aggregates. Record IDs, dates, duration counts and totals were also checked. Database role tests verified viewer read restrictions, analyst publication, count validation, immutable completed snapshots, server-side duration conversion and Riyadh dates, then rolled back. These are functional/data checks; a full browser layout and live user sign-in session have not been tested in this environment.

`dist/private-snapshot.json.gz` exists only in the owner-private native Site source. It must never be pushed to the public GitHub repository or GitHub Pages. The public `dist/config.js` must have `privateSnapshot: null` and no embedded project key. Raw files, extracted records, temporary payloads and import containers must remain outside public source control.
