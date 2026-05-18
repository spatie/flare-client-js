import { createHandleErrorWithFlare } from '../handleError';
import { getRouteContext } from './getRouteContext';
import { trackRouteContext } from './trackRouteContext.svelte';

trackRouteContext();

export const handleErrorWithFlare = createHandleErrorWithFlare(() => getRouteContext());
