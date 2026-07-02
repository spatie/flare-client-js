export { createFetchWrapper, instrumentFetch, unpatchFetch, type FetchTracer } from './instrumentFetch';
export { shouldPropagate, mergeTraceparentHeader } from './propagation';
export { fill, unfill } from './fill';
export { isNativeFetch, supportsNativeFetch } from './supportsNativeFetch';
