import os from 'node:os';

import type { Attributes } from '@flareapp/core';

/**
 * Snapshot the Node runtime + host environment at report time as OTel resource attributes. Called
 * per-report rather than cached so `process.uptime()` stays honest and `os.hostname()` tracks mid-run
 * changes; cheap enough (property reads plus a couple `os` syscalls).
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
