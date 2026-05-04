import { ErrorOrigin } from './types';

declare const process: { env?: { PACKAGE_VERSION?: string } } | undefined;

// Injected at build time via tsdown --env.PACKAGE_VERSION (reads package.json version).
export const PACKAGE_VERSION =
    typeof process !== 'undefined' && typeof process.env?.PACKAGE_VERSION !== 'undefined'
        ? process.env.PACKAGE_VERSION
        : '?';

export const MAX_HIERARCHY_DEPTH = 50;

export const DEFAULT_PROPS_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

// Default behaviour is to *extend* the built-in denylist rather than replace it, so a consumer
// adding `userId` doesn't accidentally lose redaction for `password`/`token`/etc. Pass
// replaceDefault=true to opt out (useful for tests or when the built-in matches too aggressively).
export function resolveDenylist(custom?: RegExp, replaceDefault: boolean = false): RegExp {
    if (!custom) {
        return DEFAULT_PROPS_DENYLIST;
    }

    if (replaceDefault) {
        return custom;
    }

    const flags = unionFlags(DEFAULT_PROPS_DENYLIST.flags, custom.flags);

    return new RegExp(`(?:${DEFAULT_PROPS_DENYLIST.source})|(?:${custom.source})`, flags);
}

function unionFlags(a: string, b: string): string {
    const merged = new Set<string>();

    for (const flag of a + b) {
        // 'g' and 'y' do not affect .test() of unanchored regex on a single key,
        // and combining them across user/default RegExps would change semantics.
        if (flag === 'g' || flag === 'y') {
            continue;
        }
        merged.add(flag);
    }

    return [...merged].join('');
}

export const MAX_PROP_STRING_LENGTH = 1000;

export const MAX_PROP_ARRAY_LENGTH = 100;

export const MAX_PROP_OBJECT_KEYS = 100;

export const INFO_TO_ORIGIN: Record<string, ErrorOrigin> = {
    // Development strings
    'setup function': 'setup',
    'render function': 'render',
    'component update': 'render',
    'watcher getter': 'watcher',
    'watcher callback': 'watcher',
    'watcher cleanup function': 'watcher',
    'native event handler': 'event',
    'component event handler': 'event',
    'beforeCreate hook': 'lifecycle',
    'created hook': 'lifecycle',
    'beforeMount hook': 'lifecycle',
    'mounted hook': 'lifecycle',
    'beforeUpdate hook': 'lifecycle',
    'updated hook': 'lifecycle',
    'beforeUnmount hook': 'lifecycle',
    'unmounted hook': 'lifecycle',
    'activated hook': 'lifecycle',
    'deactivated hook': 'lifecycle',
    'errorCaptured hook': 'lifecycle',
    'renderTracked hook': 'lifecycle',
    'renderTriggered hook': 'lifecycle',
    'serverPrefetch hook': 'lifecycle',
    'vnode hook': 'lifecycle',
    'directive hook': 'lifecycle',
    'transition hook': 'lifecycle',
    'ref function': 'setup',
    'async component loader': 'setup',
    'scheduler flush': 'render',
    'app errorHandler': 'lifecycle',
    'app warnHandler': 'lifecycle',
    'app unmount cleanup function': 'lifecycle',

    // Production codes
    '0': 'setup',
    '1': 'render',
    '2': 'watcher',
    '3': 'watcher',
    '4': 'watcher',
    '5': 'event',
    '6': 'event',
    '7': 'lifecycle',
    '8': 'lifecycle',
    '9': 'lifecycle',
    '10': 'lifecycle',
    '11': 'lifecycle',
    '12': 'setup',
    '13': 'setup',
    '14': 'render',
    '15': 'render',
    '16': 'lifecycle',
    'sp': 'lifecycle',
    'bc': 'lifecycle',
    'c': 'lifecycle',
    'bm': 'lifecycle',
    'm': 'lifecycle',
    'bu': 'lifecycle',
    'u': 'lifecycle',
    'bum': 'lifecycle',
    'um': 'lifecycle',
    'a': 'lifecycle',
    'da': 'lifecycle',
    'ec': 'lifecycle',
    'rtc': 'lifecycle',
    'rtg': 'lifecycle',
};
