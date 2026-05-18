import { createCaptureError } from '../captureError';
import { getRouteContext } from './getRouteContext';

export const captureError = createCaptureError((options) => getRouteContext(options?.event));
