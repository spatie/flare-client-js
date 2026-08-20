import { describe, expect, test, vi } from 'vitest';

import { BreadcrumbBuffer, RecorderType, SpanEventsRecorder, type RecorderDeps } from '../src/breadcrumbs';
import type { Config, Span } from '../src/types';

class TestRecorder extends SpanEventsRecorder {
    readonly recorderType = RecorderType.Click;

    constructor(deps: RecorderDeps, withErrors: boolean, withTraces: boolean) {
        super(deps);
        this.withErrors = withErrors;
        this.withTraces = withTraces;
    }

    record(): void {
        this.spanEvent({ type: 'browser_click', attributes: { 'browser.element.selector': 'button#pay' } });
    }
}

function setup(options: { withErrors?: boolean; withTraces?: boolean; span?: Span; config?: Partial<Config> } = {}) {
    const buffer = new BreadcrumbBuffer();
    const config = {
        maxBreadcrumbs: 100,
        maxBreadcrumbBytes: 64_000,
        maxBreadcrumbEntryBytes: 8_000,
        maxGlowsPerReport: 30,
        debug: false,
        ...options.config,
    } as Config;

    const deps: RecorderDeps = {
        getConfig: () => config,
        buffer: () => buffer,
        getActiveSpan: () => options.span,
        nowNano: () => 42,
    };

    return { buffer, recorder: new TestRecorder(deps, options.withErrors ?? true, options.withTraces ?? false) };
}

function fakeSpan(isRecording: boolean) {
    const events: { name: string }[] = [];
    return {
        span: { isRecording, addEvent: (name: string) => events.push({ name }) } as unknown as Span,
        events,
    };
}

describe('SpanEventsRecorder', () => {
    test('writes a point-in-time span event to the buffer', () => {
        const { buffer, recorder } = setup();
        recorder.record();

        expect(buffer.toEvents()).toEqual([
            {
                type: 'browser_click',
                startTimeUnixNano: 42,
                endTimeUnixNano: null,
                attributes: { 'browser.element.selector': 'button#pay' },
            },
        ]);
    });

    test('records nothing when both withErrors and withTraces are off', () => {
        const { buffer, recorder } = setup({ withErrors: false });
        recorder.record();

        expect(buffer.size).toBe(0);
    });

    test('an unsampled trace cannot make the report entry disappear', () => {
        const { span, events } = fakeSpan(false);
        const { buffer, recorder } = setup({ withTraces: true, span });
        recorder.record();

        expect(buffer.size).toBe(1);
        expect(events).toEqual([]);
    });

    test('an oversized entry is dropped, and says so when debug is on', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { buffer, recorder } = setup({ config: { debug: true, maxBreadcrumbEntryBytes: 10 } });

        recorder.record();

        expect(buffer.size).toBe(0);
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });

    test('withTraces also writes onto the current recording span', () => {
        const { span, events } = fakeSpan(true);
        const { buffer, recorder } = setup({ withTraces: true, span });
        recorder.record();

        expect(buffer.size).toBe(1);
        expect(events).toEqual([{ name: 'browser_click' }]);
    });
});
