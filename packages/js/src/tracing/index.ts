export { createFetchWrapper, instrumentFetch, unpatchFetch, type FetchTracer } from './instrumentFetch';
export { instrumentXHR, unpatchXHR, createXHROpen, createXHRSetRequestHeader, createXHRSend } from './instrumentXHR';
export { shouldPropagate, mergeTraceparentHeader } from './propagation';
export { fill, unfill } from './fill';
export { isNativeFetch, supportsNativeFetch } from './supportsNativeFetch';
export { startBrowserTracing, stopBrowserTracing, type BrowserTracingFlare } from './browserTracing';
export { type HttpTracer } from './httpRequestSpan';
