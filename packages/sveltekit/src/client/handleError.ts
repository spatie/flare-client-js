import { createHandleErrorWithFlare } from '../handleError';
import { getRouteContext } from './getRouteContext';

export const handleErrorWithFlare = createHandleErrorWithFlare(() => getRouteContext());
