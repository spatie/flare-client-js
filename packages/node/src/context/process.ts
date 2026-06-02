import os from 'node:os';

import type { Attributes } from '@flareapp/core';

/**
 * Snapshot the Node runtime + host environment at report time and project
 * into OTel-style attribute keys. Cheap (just property reads + a couple of
 * syscalls via `os`), so called per-report rather than cached; this keeps
 * `process.uptime` honest and follows the value of `os.hostname()` if it
 * changes mid-run (unlikely but free correctness).
 *
 * Keys are stable OTel resource attributes; the Flare backend recognizes them.
 */
export function collectProcessAttributes(): Attributes {
    return {
        'process.runtime.name': 'nodejs',
        'process.runtime.version': process.version,
        'process.pid': process.pid,
        'process.uptime': process.uptime(),
        'host.name': os.hostname(),
        'host.arch': process.arch,
        'os.type': os.type(),
        'os.version': os.release(),
    };
}
