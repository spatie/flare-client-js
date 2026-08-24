# Breadcrumbs are written to error reports only, never into a trace

Breadcrumb recorders write into `Scope.breadcrumbs`, which lands on `Report.events`. They never call
`Span.addEvent`, and there is no configuration option that would let them. This mirrors the PHP client's
recorders only halfway: `SpanEventsRecorder::spanEvent()` there decides separately whether to add an
entry to the report and whether to add it to the current span. We deliberately built the first decision
and left the second one out.

## Why

The fetch and XHR recorders record requests that tracing already records as `browser_fetch` and
`browser_xhr` spans. If those recorders also wrote into the current span, one trace would describe each
request twice: once as a span with a duration, and once as a span event with the settled time and the
result. Two entities for one request, in the same waterfall.

A per-recorder `withTraces` flag defaulting to false does not prevent this. It reads as a switch, and
the fetch recorder is the one where flipping it is wrong. A future developer would turn it on because it
looks available, and get silently duplicated data rather than an error.

## Consequences

Breadcrumbs and traces stay unlinked in the payload, which is already true elsewhere: `Report` carries no
trace id, so the backend cannot join an error to a trace today either.

Clicks and form changes carry no such hazard, because tracing produces no click spans. If browser traces
should ever show user interaction, that is a separate feature with its own function, and the fetch and
XHR recorders must stay out of it. That constraint is the reason this file exists.
