import os from 'node:os';

import type { Attributes } from '@flareapp/core';

/**
 * Host + process attributes, read per report so `process.uptime()` and `os.hostname()` stay current.
 * os and runtime come from `NodeDeviceInfoProvider`.
 */
export function collectProcessAttributes(): Attributes {
    return {
        'process.pid': process.pid,
        'process.uptime': process.uptime(),
        'host.name': os.hostname(),
        'host.arch': process.arch,
    };
}
