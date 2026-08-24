/**
 * Span types the Flare backend recognises. Wire format, so the values never change: they ship as the
 * `flare.span_type` attribute and the backend groups performance data by them.
 *
 * These are the browser client's set. They live in core because core's `SpanOptions.spanType` needs
 * to name them and core cannot import from `@flareapp/js`.
 */
export const BrowserSpanType = {
    Pageload: 'browser_pageload',
    Navigation: 'browser_navigation',
    Fetch: 'browser_fetch',
    Xhr: 'browser_xhr',
    Component: 'browser_component',
    WebVital: 'browser_web_vital',
} as const;

export type BrowserSpanType = (typeof BrowserSpanType)[keyof typeof BrowserSpanType];

/** Any other value stays legal, so a host SDK can stamp its own without a core release. */
export type SpanTypeName = BrowserSpanType | (string & {});

/**
 * Span event types the browser client sends on an error report. They sit apart from `BrowserSpanType`
 * because a click and a form change are points in time, not spans, and one map holding both would mean
 * two things.
 *
 * `browser_route_change` is not `browser_navigation` on purpose. A navigation on an error report has no
 * reliable end time, and one string must not mean a span with a duration in one place and a point in
 * time in another.
 */
export const BrowserSpanEventType = {
    Click: 'browser_click',
    Input: 'browser_input',
    RouteChange: 'browser_route_change',
} as const;

export type BrowserSpanEventType = (typeof BrowserSpanEventType)[keyof typeof BrowserSpanEventType];
