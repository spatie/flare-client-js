import { INFO_TO_ORIGIN } from './constants';
import { ErrorOrigin } from './types';

// Vue's `info` argument is a human-readable string in dev (e.g. "render function") but a numeric
// or short code in production builds. INFO_TO_ORIGIN maps both forms to a stable origin category.
export function getErrorOrigin(info: string): ErrorOrigin {
    return INFO_TO_ORIGIN[info] ?? 'unknown';
}
