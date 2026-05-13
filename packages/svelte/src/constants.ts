import { resolveDenylist as baseResolveDenylist } from '@flareapp/js';

import { version } from '../package.json';

export const PACKAGE_VERSION = version;

export const DEFAULT_PROPS_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

export function resolveDenylist(custom?: RegExp, replaceDefault: boolean = false): RegExp {
    return baseResolveDenylist(custom, replaceDefault, DEFAULT_PROPS_DENYLIST);
}

export const MAX_PROP_STRING_LENGTH = 1000;

export const MAX_PROP_ARRAY_LENGTH = 100;

export const MAX_PROP_OBJECT_KEYS = 100;
