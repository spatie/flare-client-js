export { shouldPropagate, mergeTraceparentHeader } from './propagation';
export { fill, unfill } from './fill';
export { isNativeFetch, supportsNativeFetch } from './supportsNativeFetch';
export { startBrowserTracing, stopBrowserTracing, type BrowserTracingFlare } from './browserTracing';
export { browserUrlContext, type HttpTracer } from './httpRequestSpan';
export { BrowserSpanType } from './spanTypes';
