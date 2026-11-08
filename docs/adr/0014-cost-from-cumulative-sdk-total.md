# 14. Track cost from the SDK's cumulative total

## Status

Accepted

## Context

longcord shows the cost of each run, per-session totals and today's spend, and enforces an
optional daily cap. Computing cost ourselves from token counts would mean maintaining a
price table for every model and provider. The Claude Agent SDK reports a cost estimate,
`total_cost_usd`, in the result message at the end of each run. Within one agent process
this figure is cumulative: it covers every run the process has handled so far, not just
the latest one. A new process (after an idle release or a restart) starts again from zero.

## Decision

- Each session runner remembers the cumulative total it has already accounted for. When a
  run finishes, the run's cost is the difference between the new total and the remembered
  one. If the new total is smaller, the process was restarted and the new total is the
  run's cost.
- The run cost is written to the event log (`run.finished`), added to the session's totals,
  and added to the per-day spend record, keyed by the computer's local date. Daily records
  are kept for 90 days.
- The daily cap is checked against that record before a message is passed to the agent.

## Consequences

- No price tables to maintain; cost follows whatever the SDK reports.
- Figures are estimates based on list prices and may differ from the provider's bill. The
  docs say so and recommend provider-side spend limits.
- A run already in progress when the cap is reached finishes, so actual spend can slightly
  exceed the cap.
