// Single source of truth for the browser client's span types. Each value is the
// `flare.span_type` attribute the tracer stamps on a span (see core Tracer). These
// strings are WIRE FORMAT: the Flare backend keys perf aggregation off them, so the
// values must never change. Re-exported from '@flareapp/js/browser' so @flareapp/react
// and the playgrounds reference this set instead of re-typing the literals.
export const BrowserSpanType = {
    Pageload: 'browser_pageload',
    Navigation: 'browser_navigation',
    Fetch: 'browser_fetch',
    Xhr: 'browser_xhr',
    ReactComponent: 'browser_react_component',
} as const;

export type BrowserSpanType = (typeof BrowserSpanType)[keyof typeof BrowserSpanType];
