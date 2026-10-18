# stc COW Performance Analysis — Use Case 04

A monthly review website for COW passive infrastructure operations. It provides monthly and year-over-year comparisons, regional results, root causes, recurring sites, a sortable ticket register with source details, review commentary, CSV export, and a print layout for saving monthly reviews as PDF.

## Run

The website has no build or package dependencies. Serve `dist/` with a static web server, for example:

```bash
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. The public repository contains application code and a report filter profile. It contains **no operational ticket data, source workbook, PBIX file, passwords, or secret keys**.

## PostgreSQL project

The configured project is `https://vtsqazxhszbmwiswthgt.supabase.co`.

1. Apply `database/001_performance.sql` in the project's SQL editor. It creates only tables and functions beginning with `performance_`. Review the migration before applying it to an existing project.
2. Use an existing approved Supabase Auth account, or create an account in the project's Auth administration. There is no public registration in this app.
3. Grant the account a performance role with the bootstrap SQL at the end of the migration. Roles are `admin`, `analyst`, and `viewer`. Membership administration stays in the project SQL editor.
4. Open **Data & settings** on the website. Enter the project's publishable key (or legacy anon key) and sign in with the approved account. The client rejects service-role and secret keys. Public configuration is saved on the current browser; Auth tokens stay in session storage.
5. Upload and preview the prepared data file, then choose **Save to PostgreSQL**. The first complete import is required before database results can load. Administrators and analysts can import and save shared monthly reviews; viewers can read.
6. Run `database/verify_access.sql` and test a viewer and an analyst account in the deployed application. Local unit tests use a mocked database and do not prove deployed RLS behavior.

Alternatively, set the client **publishable** key in `dist/config.js` for shared deployment. Leave all secret keys out of browser code, source control, and chat. `privateSnapshot` must remain `null` on public deployments.

## Prepare the supplied data

The conversion uses Python's standard library and does not alter either source file:

```bash
python scripts/extract_data.py \
  "/private/Accumulative Outages Power report.xlsb" \
  "/private/Weekly Overview V3.pbix" \
  "/private/performance-output"
```

It reads `SIR - ACES NOC.` from the XLSB and reads the monthly filter profile from the PBIX report layout. It produces a compressed JSON import, normalized CSV and NDJSON, source metadata, and a duplicate resolution log. Keep these outputs private. **Do not commit them to this public repository.**

Import the JSON.GZ file through the website, or use the terminal importer:

```bash
python scripts/import_postgres.py /private/performance-output/performance-data.json.gz
```

The importer prompts for the client key, email and password. It does not put credentials in command-line arguments or write them to disk.

For recurring updates, replace the source export and run the same conversion and import. No automatic connection to RTTS or Power BI refresh is configured. The XLSB reader supports the record types present in the supplied workbook; compare the exported row counts after converting a different workbook.

## Calculation basis

| Item | Definition |
| --- | --- |
| Reporting period | Month of Create Date, interpreted in Asia/Riyadh. A ticket stays in its creation month even if it clears in another month. |
| Default scope | Outage service impact, blank Parent TT, and the explicit exclusions from the PBIX Monthly Overview (SA) page. |
| All recorded faults | Removes parent and root cause exclusions; retains the visible impact and other filters. |
| Ticket volume | Distinct ticket numbers. Stored grain is ticket/site. Regional distinct counts may overlap if a future source links one ticket to multiple sites. |
| Duplicate snapshots | Retain the most complete row; break ties by latest cleared timestamp, then earliest source row. |
| Restoration hours | Sum of recorded RestorationTime HHMMSS multiplied by 24. Source Excel duration values are fractions of a day. |
| Mean restoration | Total recorded minutes / number of records with a valid duration. Missing durations are excluded; zero is retained. |
| SLA compliance | Non-breached / eligible records. Eligibility needs an explicit Exceed SLA Yes/No and no Exclude/Excluded SLA marker. Source SLA decisions are retained. |
| Service interruption | Sum of nonnegative Service Impact Finish − Start intervals. Overlapping ticket intervals are not merged. |
| Recurring sites | Sites with at least two tickets in the selected month and scope. |
| Comparisons | Same filters in the previous calendar month or same month of the prior year. No growth rate is reported against zero or missing coverage. |

The app preserves source date inconsistencies and exposes them in source checks and ticket details. Recorded durations are not silently replaced with a recalculated interval. Network availability is not calculated because a historical on-air inventory denominator was not provided.

**PBIX limitation:** the report layout, field references and monthly filter list were inspected. Compressed VertiPaq table rows and DAX expressions were not decoded. The actual records are extracted from the supplied workbook. Exact parity with the PBIX measure `New Duration Dax Min` has not been established.

## Access and data protection

- All four performance tables have RLS enabled. Anonymous roles receive no table privileges.
- Approved members can read; analysts and administrators can import and write reviews. Browser clients cannot grant their own membership or delete records.
- Imports upsert a stable ticket/site ID and record the source hash, source date range and import state. Failed or pending imports block database result loading; a count check is required before completion. Retry the same file after a failed import. A failed import can have written some batches, so it is not advertised as atomic.
- Database loading follows stable keyset pagination and rechecks import state before exposing results. It does not accept the API's default first page as the whole dataset.
- The private review deployment can contain an owner-restricted source snapshot. That snapshot is a separate private deployment asset and is excluded from the public GitHub commit. It is clearly labeled in the interface until PostgreSQL synchronization is active.
- Review notes made in snapshot mode remain on that browser. Shared PostgreSQL reviews use the selected month and filter scope as their key.

## Validation

```bash
npm run check
npm test
```

Tests cover calculation denominators, scope exclusions, calendar boundaries, source-column imports, duplicate handling, CSV escaping, all six view renderers, site drill-downs, key rejection, database pagination, and failed imports. They do not replace a visual browser check or a live project RLS check.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
