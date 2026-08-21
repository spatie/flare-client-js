import { describe, expect, test } from 'vitest';

import { BreadcrumbBuffer, RecorderType } from '../src/breadcrumbs';
import type { SpanEvent } from '../src/types';
import { breadcrumbLimits } from './helpers';

const event = (type: string, padding = ''): SpanEvent => ({
    type,
    startTimeUnixNano: 1_000_000_000,
    endTimeUnixNano: null,
    attributes: padding ? { pad: padding } : {},
});

const click = (padding = '') => ({ event: event('browser_click', padding), recorder: RecorderType.Click });
const glow = (name: string) => ({
    event: event('php_glow'),
    recorder: RecorderType.Glow,
    glow: { name, messageLevel: 'info' as const, metaData: {}, time: 1, microtime: 1 },
});

describe('BreadcrumbBuffer', () => {
    test('keeps entries in insertion order and hands them back as span events', () => {
        const buffer = new BreadcrumbBuffer();
        buffer.add(click(), breadcrumbLimits());
        buffer.add(glow('a'), breadcrumbLimits());

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['browser_click', 'php_glow']);
        expect(buffer.size).toBe(2);
    });

    // Step 1 of the eviction algorithm.
    test('drops an entry over maxBreadcrumbEntryBytes without touching the buffer', () => {
        const buffer = new BreadcrumbBuffer();
        buffer.add(click(), breadcrumbLimits());
        const sizeBefore = buffer.size;
        const bytesBefore = buffer.bytes;

        const kept = buffer.add(click('x'.repeat(200)), breadcrumbLimits({ maxBreadcrumbEntryBytes: 100 }));

        expect(kept).toBe(false);
        expect(buffer.size).toBe(sizeBefore);
        expect(buffer.bytes).toBe(bytesBefore);
    });

    // Step 3 of the eviction algorithm, entry count.
    test('trims the oldest once it passes maxBreadcrumbs', () => {
        const buffer = new BreadcrumbBuffer();
        for (const type of ['a', 'b', 'c']) {
            buffer.add({ event: event(type), recorder: RecorderType.Click }, breadcrumbLimits({ maxBreadcrumbs: 2 }));
        }

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['b', 'c']);
    });

    // Step 3 of the eviction algorithm, bytes.
    test('trims the oldest once it passes maxBreadcrumbBytes', () => {
        const buffer = new BreadcrumbBuffer();
        const oneEntry = breadcrumbLimits({ maxBreadcrumbEntryBytes: 8_000 });
        buffer.add(click('x'.repeat(500)), oneEntry);
        const singleEntryBytes = buffer.bytes;

        buffer.add(
            { event: event('second', 'x'.repeat(500)), recorder: RecorderType.Click },
            {
                ...oneEntry,
                maxBreadcrumbBytes: singleEntryBytes + 10,
            },
        );

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['second']);
    });

    // Step 3 of the eviction algorithm, the glow reserve.
    test('eviction passes over glows while there are maxGlowsPerReport or fewer', () => {
        const buffer = new BreadcrumbBuffer();
        const reserve = breadcrumbLimits({ maxBreadcrumbs: 3, maxGlowsPerReport: 2 });
        buffer.add(glow('kept-1'), reserve);
        buffer.add(glow('kept-2'), reserve);
        buffer.add(click(), reserve);
        buffer.add({ event: event('newest'), recorder: RecorderType.Click }, reserve);

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['php_glow', 'php_glow', 'newest']);
        expect(buffer.glows().map((g) => g.name)).toEqual(['kept-1', 'kept-2']);
    });

    // Step 3 of the eviction algorithm, over the reserve.
    test('eviction takes the oldest entry of any kind once glow count exceeds the reserve', () => {
        const buffer = new BreadcrumbBuffer();
        const reserve = breadcrumbLimits({ maxBreadcrumbs: 3, maxGlowsPerReport: 2 });
        buffer.add(glow('a'), reserve);
        buffer.add(glow('b'), reserve);
        buffer.add(glow('c'), reserve);
        buffer.add(click(), reserve);

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['php_glow', 'php_glow', 'browser_click']);
        expect(buffer.glows().map((g) => g.name)).toEqual(['b', 'c']);
    });

    // Step 4 of the eviction algorithm.
    test('a buffer of nothing but reserved glows still yields to a hard cap', () => {
        const buffer = new BreadcrumbBuffer();
        const reserve = breadcrumbLimits({ maxBreadcrumbs: 2, maxGlowsPerReport: 30 });
        buffer.add(glow('a'), reserve);
        buffer.add(glow('b'), reserve);
        buffer.add(glow('c'), reserve);

        expect(buffer.glows().map((g) => g.name)).toEqual(['b', 'c']);
    });

    // A negative maxBreadcrumbs re-enters the eviction loop on an empty buffer; it must degrade, not throw.
    test('a negative maxBreadcrumbs empties the buffer instead of throwing', () => {
        const buffer = new BreadcrumbBuffer();

        expect(() => buffer.add(click(), breadcrumbLimits({ maxBreadcrumbs: -1 }))).not.toThrow();
        expect(buffer.size).toBe(0);
    });

    test('clearRecorder removes only that recorder and gives its bytes back', () => {
        const buffer = new BreadcrumbBuffer();
        buffer.add(click(), breadcrumbLimits());
        const clickOnlyBytes = buffer.bytes;
        buffer.add(glow('a'), breadcrumbLimits());

        buffer.clearRecorder(RecorderType.Glow);

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['browser_click']);
        expect(buffer.bytes).toBe(clickOnlyBytes);
        expect(buffer.glows()).toEqual([]);
    });

    test('hands out copies, so a beforeSubmit hook cannot rewrite the buffer', () => {
        const buffer = new BreadcrumbBuffer();
        buffer.add(click('original'), breadcrumbLimits());

        const drained = buffer.toEvents();
        drained[0].type = 'rewritten';
        drained[0].attributes.pad = 'rewritten';

        expect(buffer.toEvents()[0].type).toBe('browser_click');
        expect(buffer.toEvents()[0].attributes.pad).toBe('original');
    });

    test('survives circular glow context instead of throwing', () => {
        const buffer = new BreadcrumbBuffer();
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        const kept = buffer.add(
            {
                event: { ...event('php_glow'), attributes: { 'glow.context': circular } as SpanEvent['attributes'] },
                recorder: RecorderType.Glow,
            },
            breadcrumbLimits(),
        );

        expect(kept).toBe(true);
        expect(buffer.size).toBe(1);
    });
});
