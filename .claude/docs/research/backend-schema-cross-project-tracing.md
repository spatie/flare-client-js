# Spec (exploratory): backend schema hierarchy for cross-project tracing

Status: **exploration only, not a commitment.** Date: 2026-06-15. This is a standalone thought-experiment spun out of
the performance-tracing research (`.claude/docs/research/performance-tracing.md`). It is deliberately kept OUT of that
doc. It concerns the **Flare backend** (`/Users/driesheyninck/srv/flareapp.io`), not the JS client. Nothing here is
decided; it captures one option for discussion.

## Problem being explored

A distributed trace crosses a frontend and a backend that are **separate Flare projects** today. We want:

1. A link between the frontend trace and the backend trace.
2. The full frontend trace (page load + all API calls) in one view.
3. Click-through from any frontend API-call span to the backend trace it triggered, and vice versa.

`traceparent` propagation already makes both sides share a `traceId` and sets the backend request span's
`parentSpanId` to the browser's fetch span id (see the perf doc §4.6 / §2.5 / §3.3). But everything in the backend is
**project-scoped**, so the shared id alone does not link anything:

- ClickHouse spans: `PRIMARY KEY (project_id, trace_id)` — a trace view returns only one project's spans.
- `missing_span_links` resolution keys on `{project_id}_{trace_id}_{parent_span_id}`
  (`app/Domain/Monitoring/Actions/ProcessMissingSpanLinksAction.php`) — a backend span never finds a parent that
  lives in a different project.

So the trace must _live_ one level above the thing an API key maps to today.

## Proposed hierarchy

Original sketch was a strict chain `Team > Project > App > Environment` (Project becomes overarching, App = old
Project, Environment below each App). The chain is mostly right but the **Environment placement is wrong**: a trace
crosses apps yet must stay inside one environment (prod-frontend → prod-backend, never → staging-backend). If
Environment is a child of App, `frontend.production` and `backend.production` are different rows and you must match
them by environment _name_ across apps in the hot path. The identity tracing needs ("the production run of this whole
system") is Project-level, not per-app.

### Recommended shape: two orthogonal axes under Project

```
Team
 └── Project                  (NEW: the overarching system; trace namespace)
      ├── App         ← structural axis: frontend, api, worker  (each = old "project")
      └── Environment ← deployment axis: production, staging, dev (shared across apps)
```

- A span belongs to a `(Project, App, Environment)` triple.
- **Trace boundary = `(Project, Environment)`** — spans Apps, pinned to one Environment.
- **Team** — org, members, billing. Unchanged.
- **Project** — a related set of deployables that talk to each other. Trace namespace.
- **App** — one deployable. A tag/FK on each span, NOT a parent of Environment.
- **Environment** — defined once at Project level so "production" means the same across apps.

## Storage / partition implications

Unavoidable regardless of naming: the trace partition key moves up a level.

- Spans: `project_id` now means the **overarching** project; add `app_id` + `environment_id` columns; ordering
  becomes roughly `(project_id, environment_id, trace_id, span_id)`.
- `missing_span_links`: change `project_id` to the overarching project and add `environment_id`. This single change
  is what unlocks goal 1's link — a backend span now shares the partition with its frontend parent and resolves
  automatically.
- Cross-project click-through (goal 3) collapses into **intra-project filtering**: "trace `T` in `(Project, prod)`",
  group/color spans by `app_id`, deep-link = filter to the other app. No bespoke cross-project lookup table needed.

## API keys

A key resolves to a single `(App, Environment)` pair — e.g. "frontend / production". Ingestion derives `project_id`
from the app and stamps the span with all three ids. Each deployable gets a narrowly scoped key; a leaked
frontend-prod key cannot write backend or staging spans. Better posture than today's one-key-per-project.

## Migration

- Each existing project → an **App**, auto-wrapped in a 1:1 **Project** (single-app users notice nothing).
- Backfill a default **Environment** (existing data → "production" / "unknown").
- Existing API keys keep working, resolving to `(app, default-env)`.
- Mechanical but broad: ClickHouse keys, Postgres, ingestion auth, every aggregation query, UI, public API, and the
  MCP performance tools. This would be the single largest backend change in the tracing effort.

## Open question

Is **App** first-class (own settings, members, retention) or just a string tag on spans?

- First-class table: needed if API keys map to it and you want per-app config. (Lean: yes.)
- String attribute: cheaper, still supports click-through, but no per-app settings.

## Comparison vs Sentry

Sentry is `Org > Project`, Environment as a tag, trace boundary = the whole Org. The middle **Project** layer here is
a genuine improvement: it scopes the trace namespace to a _related_ set of apps instead of the entire team, so a team
running several unrelated systems does not get cross-contaminated traces.

## Sampling note (carried over from perf doc §4.6)

Continuation is head-based: the browser sets the `traceparent` sampled flag and the backend **inherits** it. Browser
samples out → backend does not record even if its own sampler would have. This interacts with any per-environment
sampling config the hierarchy above might introduce; decide whether the frontend should dictate backend sampling.

## Not in scope here

This spec does not cover the JS client, the OTLP wire format, span taxonomy (`SpanType`/`SpanAggregator`), or the
public-vs-private key question. Those live in the performance-tracing research doc. This file is only the
schema-hierarchy exploration.
