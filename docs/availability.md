# SA availability

City Sites use Metro Node Classification (target 99.96%, KPI weight 10%) and
Non City Sites use Remote Node Classification (target 95.00%, KPI weight 10%).
Use the ticket's classification from the SIR - ACES NOC. tab, including labels
such as SC_P3 Metro. When the label is generic, use an unambiguous classification
for the same COW in the same source month, if one exists. Dashboard filters
select the outage hours counted. Filtered figures retain the confirmed national
fleet denominator and are labeled fleet basis.

Availability is 100 × (1 − chargeable SA outage hours / scheduled site-hours).
Calculate scheduled hours as the confirmed on-air count for the category times
the number of hours in the covered period. Use Saudi local dates, and stop at the
last covered day of the ticket import. The dashboard starts on 1 January 2025.
Sum the same recorded outage duration used in the Duration KPI, by Ticket Number
and ticket created date. NSA, parent-linked, duplicate repair and resolution
records do not contribute. Only tickets with a valid RTTS Closed Date count.
A Cleared Date by itself does not qualify a ticket.

When an outage duration or classification is missing, the affected period is
marked as recorded data only and is not graded against the target as a confirmed
KPI.

## Updating the inputs

The authenticated dashboard reads two rows of
`public.performance_availability_inputs`. Use the migration in
`database/006_sa_availability.sql` on a new project. Apply the table/function
migrations only once to a project. Apply
`database/007_sa_availability_closed_date.sql` to expose the Closed Date on
the authenticated ticket feed.

- `schedule` uses `basis: "monthly-on-air-roster"`, `from: "2025-01-01"`, and
  `months` keyed by YYYY-MM. Each verified month's object has
  `counts: {"city": 241, "non-city": 175}` and `total: 416` (example).
  Count distinct COWs whose CMDB Site status is ON-AIR and group by
  Remote / Metropolitan. Sum the corresponding roster's site-hours for each
  covered day. A period with any missing month has no availability result.
  A single roster explicitly agreed for every period can use
  `basis: "fixed-monthly-roster"` with top-level `counts` and `total`.
- `approvals` payload: `{"source":"SLA Approval","records":[{"ticket_number":"PR001","approved_minutes":60}]}`.
  The ticket above is an example. From the SLA Approval tab, keep only records
  marked APPROVED with STC NOC Final Acceptance YES and Service Impacted Outage.
  Use STC NOC Final Agreed Hours × 60; deduplicate and match the ticket number
  against the current dashboard import. Rebuild the list when approvals change.

An authorized database writer replaces each applicable payload and sets
`updated_at=now()`. Open dashboards refresh after the revision changes.
No approval workbook or private ticket data belongs in the site repository.

For each matching ticket, cap credit at its recorded outage duration. Sum the
remaining outage durations within each category and covered period. This
reconciles the KPI to the dashboard's outage-duration measure.
