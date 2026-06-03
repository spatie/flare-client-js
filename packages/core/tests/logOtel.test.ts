import { describe, expect, it } from 'vitest';

import { attributesToOpenTelemetry, valueToOpenTelemetry } from '../src/logging/otel';

describe('valueToOpenTelemetry', () => {
    it('encodes primitives', () => {
        expect(valueToOpenTelemetry('x')).toEqual({ stringValue: 'x' });
        expect(valueToOpenTelemetry(true)).toEqual({ boolValue: true });
        expect(valueToOpenTelemetry(3)).toEqual({ intValue: 3 });
        expect(valueToOpenTelemetry(3.5)).toEqual({ doubleValue: 3.5 });
    });

    it('drops null, undefined and non-finite numbers', () => {
        expect(valueToOpenTelemetry(null)).toBeNull();
        expect(valueToOpenTelemetry(undefined as never)).toBeNull();
        expect(valueToOpenTelemetry(NaN)).toBeNull();
        expect(valueToOpenTelemetry(Infinity)).toBeNull();
        expect(valueToOpenTelemetry(-Infinity)).toBeNull();
    });

    it('drops nulls recursively in arrays and objects', () => {
        expect(valueToOpenTelemetry([1, null, 2])).toEqual({
            arrayValue: { values: [{ intValue: 1 }, { intValue: 2 }] },
        });
        expect(valueToOpenTelemetry({ a: 1, b: null })).toEqual({
            kvlistValue: { values: [{ key: 'a', value: { intValue: 1 } }] },
        });
    });

    it('replaces cyclic references with a [Circular] sentinel without throwing', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        expect(() => valueToOpenTelemetry(cyclic as never)).not.toThrow();
        const encoded = valueToOpenTelemetry(cyclic as never) as {
            kvlistValue: { values: Array<{ key: string; value: unknown }> };
        };
        const selfEntry = encoded.kvlistValue.values.find((v) => v.key === 'self');
        expect(selfEntry?.value).toEqual({ stringValue: '[Circular]' });
    });
});

describe('attributesToOpenTelemetry', () => {
    it('maps entries to key/value and drops null-valued entries', () => {
        expect(attributesToOpenTelemetry({ a: 'x', b: null })).toEqual([{ key: 'a', value: { stringValue: 'x' } }]);
    });
});
