import { describe, expect, test, vi } from 'vitest';

import { BreadcrumbBuffer, GlowRecorder, RecorderType, type RecorderDeps } from '../src/breadcrumbs';
import type { Config } from '../src/types';

function setup() {
    const buffer = new BreadcrumbBuffer();
    const config = {
        maxBreadcrumbs: 100,
        maxBreadcrumbBytes: 64_000,
        maxBreadcrumbEntryBytes: 8_000,
        maxGlowsPerReport: 30,
    } as Config;

    const deps: RecorderDeps = {
        getConfig: () => config,
        buffer: () => buffer,
        getActiveSpan: () => undefined,
        nowNano: () => 0,
    };

    return { buffer, recorder: new GlowRecorder(deps) };
}

describe('GlowRecorder', () => {
    test('produces a php_glow span event with the documented attributes', () => {
        const { buffer, recorder } = setup();
        recorder.record('rendering checkout', 'info', { cartId: 7 });

        const event = buffer.toEvents()[0];
        expect(event.type).toBe('php_glow');
        expect(event.endTimeUnixNano).toBeNull();
        expect(event.attributes).toEqual({
            'glow.name': 'rendering checkout',
            'glow.level': 'info',
            'glow.context': { cartId: 7 },
        });
    });

    test('keeps the Glow object on the entry so Flare.glows still works', () => {
        const { buffer, recorder } = setup();
        recorder.record('a', 'warning', { x: 1 });

        expect(buffer.glows()).toHaveLength(1);
        expect(buffer.glows()[0].name).toBe('a');
        expect(buffer.glows()[0].messageLevel).toBe('warning');
    });

    test('time is whole seconds and microtime carries the milliseconds', () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_123);
        const { buffer, recorder } = setup();

        recorder.record('a', 'info', {});

        const [glow] = buffer.glows();
        expect(glow.time).toBe(1_700_000_000);
        expect(glow.microtime).toBe(1_700_000_000.123);
        // The wire timestamp comes off microtime, so two glows in one second no longer collide.
        expect(buffer.toEvents()[0].startTimeUnixNano).toBe(Math.round(1_700_000_000.123 * 1_000_000_000));
        clock.mockRestore();
    });

    test('clear removes only glow entries', () => {
        const { buffer, recorder } = setup();
        buffer.add(
            {
                event: { type: 'browser_click', startTimeUnixNano: 1, endTimeUnixNano: null, attributes: {} },
                recorder: RecorderType.Click,
            },
            { maxBreadcrumbs: 100, maxBreadcrumbBytes: 64_000, maxBreadcrumbEntryBytes: 8_000, maxGlowsPerReport: 30 },
        );
        recorder.record('a', 'info', {});

        recorder.clear();

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['browser_click']);
    });
});
