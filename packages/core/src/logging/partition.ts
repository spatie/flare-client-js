import type { Attributes } from '../types';

// Resource-level key prefixes. Every other key is record-level. A static key placed at record-level just
// duplicates data; a request-varying key placed at resource-level corrupts batched envelopes, so
// record-level is the safe default.
const RESOURCE_PREFIXES = [
    'service.',
    'telemetry.',
    'host.',
    'os.',
    'process.',
    'device.',
    'network.',
    'flare.framework.',
    'flare.language.',
];

// Keys that match a resource prefix but are not instance-static, so they stay record-level. process.uptime
// changes every read; promoting it would tag batched records with the flush-time value.
const RECORD_LEVEL_EXCEPTIONS = new Set(['process.uptime']);

export function partitionAttributes(attributes: Attributes): {
    resource: Attributes;
    record: Attributes;
} {
    const resource: Attributes = {};
    const record: Attributes = {};
    for (const [key, value] of Object.entries(attributes)) {
        const isResource =
            !RECORD_LEVEL_EXCEPTIONS.has(key) && RESOURCE_PREFIXES.some((prefix) => key.startsWith(prefix));
        if (isResource) {
            resource[key] = value;
        } else {
            record[key] = value;
        }
    }
    return { resource, record };
}
