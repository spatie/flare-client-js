import type { Attributes } from '../types';

// Allowlist of resource-level key prefixes. Every other key — known or unknown —
// is record-level. Mis-placing a static key on a record costs a little duplication;
// mis-placing a request-varying key on the shared resource corrupts batched
// envelopes, so record-level is the safe default.
const RESOURCE_PREFIXES = ['service.', 'telemetry.', 'host.', 'os.', 'process.', 'flare.framework.', 'flare.language.'];

// Keys that match a resource prefix but are NOT instance-static, so they must stay
// record-level. `process.uptime` changes every read; promoting it to the shared
// envelope resource would tag batched records with the flush-time value.
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
