import os from 'node:os';

import type { Attributes } from '@flareapp/core';

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
