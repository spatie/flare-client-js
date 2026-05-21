import { createHandleErrorWithFlare } from '../handleError.js';
import { getRouteContext } from './getRouteContext.js';

export const handleErrorWithFlare = createHandleErrorWithFlare((input) => getRouteContext(input.event));
