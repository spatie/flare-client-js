import { createCaptureError } from '../captureError.js';
import { getRouteContext } from './getRouteContext.js';

export const captureError = createCaptureError((options) => getRouteContext(options?.event));
