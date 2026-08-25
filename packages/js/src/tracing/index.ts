export {
    isNativeFetch,
    mergeTraceparentHeader,
    shouldPropagate,
    supportsNativeFetch,
    traceRequests,
    type HttpTracer,
} from './requests';
export { fill, unfill } from './utils';
export { startBrowserTracing, stopBrowserTracing, type BrowserTracingFlare } from './roots';
export { BrowserSpanType } from './spanTypes';
