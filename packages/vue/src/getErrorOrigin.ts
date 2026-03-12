import { INFO_TO_ORIGIN } from './constants';
import { ErrorOrigin } from './types';

export function getErrorOrigin(info: string): ErrorOrigin {
    return INFO_TO_ORIGIN[info] ?? 'unknown';
}
