import { afterEach, describe, expect, test, vi } from 'vitest';

import { BreadcrumbBuffer, GlowRecorder, RecorderType, type RecorderDeps } from '../src/breadcrumbs';
import type { Config } from '../src/types';
import { breadcrumbLimits } from './helpers';

function setup(nowNano: () => number = () => 0) {
    const buffer = new BreadcrumbBuffer();
    const config = breadcrumbLimits() as Config;

    const deps: RecorderDeps = {
        getConfig: () => config,
        buffer: () => buffer,
        getActiveSpan: () => undefined,
        nowNano,
    };

    return { buffer, recorder: new GlowRecorder(deps) };
}

describe('GlowRecorder', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

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

    test('time is whole seconds and microtime carries the sub-second precision', () => {
        // 1,700,000,000.5s, expressed in nanoseconds, the unit deps.nowNano() returns.
        const nowNano = 1_700_000_000_500_000_000;
        const { buffer, recorder } = setup(() => nowNano);

        recorder.record('a', 'info', {});

        const [glow] = buffer.glows();
        expect(glow.time).toBe(1_700_000_000);
        expect(glow.microtime).toBe(1_700_000_000.5);
        // The wire timestamp comes off microtime, not time, so two glows in one second no longer collide.
        expect(buffer.toEvents()[0].startTimeUnixNano).toBe(nowNano);
    });

    test('clear removes only glow entries', () => {
        const { buffer, recorder } = setup();
        buffer.add(
            {
                event: { type: 'browser_click', startTimeUnixNano: 1, endTimeUnixNano: null, attributes: {} },
                recorder: RecorderType.Click,
            },
            breadcrumbLimits(),
        );
        recorder.record('a', 'info', {});

        recorder.clear();

        expect(buffer.toEvents().map((e) => e.type)).toEqual(['browser_click']);
    });
});
