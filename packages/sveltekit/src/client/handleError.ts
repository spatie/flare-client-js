import { createHandleErrorWithFlare } from '../handleError.js';
import { getRouteContext } from './getRouteContext.js';
import { trackRouteContext } from './trackRouteContext.svelte.js';

trackRouteContext();

export const handleErrorWithFlare = createHandleErrorWithFlare(() => getRouteContext());
