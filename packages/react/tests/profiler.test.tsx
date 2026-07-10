// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { StrictMode, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => {
    let counter = 0;
    return {
        activeComponentRoot: vi.fn((): { traceId: string; parentSpanId: string } | null => ({
            traceId: 'T',
            parentSpanId: 'root',
        })),
        reserveSpanId: vi.fn(() => `s${++counter}`),
        recordComponentSpan: vi.fn(),
        nowNano: vi.fn(() => 1000),
        reset: () => {
            counter = 0;
        },
    };
});
vi.mock('@flareapp/js/browser', () => ({
    activeComponentRoot: seam.activeComponentRoot,
    reserveSpanId: seam.reserveSpanId,
    recordComponentSpan: seam.recordComponentSpan,
    nowNano: seam.nowNano,
}));

import { FlareProfiler, withFlareProfiler } from '../src/profiler';

beforeEach(() => {
    seam.reset();
    seam.recordComponentSpan.mockReset();
    seam.reserveSpanId.mockClear();
    seam.activeComponentRoot.mockReset().mockReturnValue({ traceId: 'T', parentSpanId: 'root' });
    seam.nowNano.mockReset().mockReturnValue(1000);
});
afterEach(cleanup);

const calls = () =>
    seam.recordComponentSpan.mock.calls.map(
        (c) => c[0] as { name: string; spanId: string; parent: { traceId: string; parentSpanId: string } },
    );

describe('FlareProfiler', () => {
    it('records one span for a single component, parented to the active root', () => {
        render(
            <FlareProfiler name="Solo">
                <div>content</div>
            </FlareProfiler>,
        );
        expect(seam.recordComponentSpan).toHaveBeenCalledTimes(1);
        expect(calls()[0]).toMatchObject({
            name: 'Solo',
            spanId: 's1',
            parent: { traceId: 'T', parentSpanId: 'root' },
            startTimeUnixNano: 1000,
            endTimeUnixNano: 1000,
        });
    });

    it('nests a child span under its profiled parent', () => {
        render(
            <FlareProfiler name="Parent">
                <FlareProfiler name="Child">
                    <div>x</div>
                </FlareProfiler>
            </FlareProfiler>,
        );
        // Effects fire bottom-up: Child records first (s2 under parent s1), then Parent (s1 under root).
        const byName = Object.fromEntries(calls().map((c) => [c.name, c]));
        expect(byName.Parent).toMatchObject({ spanId: 's1', parent: { parentSpanId: 'root' } });
        expect(byName.Child).toMatchObject({ spanId: 's2', parent: { parentSpanId: 's1' } });
    });

    it('is transparent when unprofiled: a grandchild nests under the nearest profiled ancestor', () => {
        const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
        render(
            <FlareProfiler name="Ancestor">
                <Passthrough>
                    <FlareProfiler name="Descendant">
                        <div>x</div>
                    </FlareProfiler>
                </Passthrough>
            </FlareProfiler>,
        );
        const byName = Object.fromEntries(calls().map((c) => [c.name, c]));
        expect(byName.Descendant).toMatchObject({ parent: { parentSpanId: 's1' } }); // under Ancestor, not the plain div
    });

    it('records nothing but still renders children when there is no active root', () => {
        seam.activeComponentRoot.mockReturnValue(null);
        const { getByText } = render(
            <FlareProfiler name="Solo">
                <div>still here</div>
            </FlareProfiler>,
        );
        expect(seam.recordComponentSpan).not.toHaveBeenCalled();
        expect(seam.reserveSpanId).not.toHaveBeenCalled();
        expect(getByText('still here')).toBeTruthy();
    });

    it('never throws when the seam throws', () => {
        seam.recordComponentSpan.mockImplementation(() => {
            throw new Error('boom');
        });
        expect(() =>
            render(
                <FlareProfiler name="Solo">
                    <div>x</div>
                </FlareProfiler>,
            ),
        ).not.toThrow();
    });

    it('never throws, and still renders children, when activeComponentRoot throws (render phase)', () => {
        seam.activeComponentRoot.mockImplementation(() => {
            throw new Error('boom');
        });
        let getByText!: ReturnType<typeof render>['getByText'];
        expect(() => {
            ({ getByText } = render(
                <FlareProfiler name="Solo">
                    <div>still here</div>
                </FlareProfiler>,
            ));
        }).not.toThrow();
        expect(getByText('still here')).toBeTruthy();
    });

    it('never throws, still renders children, and skips recording when reserveSpanId throws (render phase)', () => {
        // mockImplementationOnce, not mockImplementation: reserveSpanId is only
        // mockClear()'d (not mockReset()'d) in beforeEach, so a persistent throwing
        // implementation would leak into every later test in this file.
        seam.reserveSpanId.mockImplementationOnce(() => {
            throw new Error('boom');
        });
        let getByText!: ReturnType<typeof render>['getByText'];
        expect(() => {
            ({ getByText } = render(
                <FlareProfiler name="Solo">
                    <div>still here</div>
                </FlareProfiler>,
            ));
        }).not.toThrow();
        expect(getByText('still here')).toBeTruthy();
        expect(seam.recordComponentSpan).not.toHaveBeenCalled();
    });

    it('records exactly once under StrictMode (no duplicate spanId)', () => {
        render(
            <StrictMode>
                <FlareProfiler name="Solo">
                    <div>x</div>
                </FlareProfiler>
            </StrictMode>,
        );
        expect(seam.recordComponentSpan).toHaveBeenCalledTimes(1);
    });

    it('records a suspended child under its profiled ancestor once it resolves', async () => {
        let resolve!: () => void;
        const gate = new Promise<void>((r) => {
            resolve = r;
        });
        let ready = false;
        const Suspender = () => {
            if (!ready) throw gate;
            return <div>loaded</div>;
        };
        render(
            <FlareProfiler name="Ancestor">
                <Suspense fallback={<div>loading</div>}>
                    <FlareProfiler name="Lazy">
                        <Suspender />
                    </FlareProfiler>
                </Suspense>
            </FlareProfiler>,
        );
        ready = true;
        await vi.waitFor(() => {
            resolve();
            const byName = Object.fromEntries(calls().map((c) => [c.name, c]));
            expect(byName.Lazy).toMatchObject({ parent: { parentSpanId: 's1' } });
        });
    });
});

describe('withFlareProfiler', () => {
    it('resolves the name from options over displayName over Component.name', () => {
        function Named() {
            return <div>n</div>;
        }
        const WithName = withFlareProfiler(Named);
        render(<WithName />);
        expect(calls()[0]!.name).toBe('Named');

        seam.recordComponentSpan.mockClear();
        const Displayed = () => <div>d</div>;
        Displayed.displayName = 'Display';
        const WithDisplayName = withFlareProfiler(Displayed);
        render(<WithDisplayName />);
        expect(calls()[0]!.name).toBe('Display'); // displayName beats Component.name ('Displayed')

        seam.recordComponentSpan.mockClear();
        const Explicit = withFlareProfiler(Displayed, { name: 'Explicit' });
        render(<Explicit />);
        expect(calls()[0]!.name).toBe('Explicit'); // explicit beats displayName
    });

    it('falls through an empty Component.name to Unknown (|| not ??)', () => {
        const Anon = () => <div>a</div>;
        Object.defineProperty(Anon, 'name', { value: '' });
        const WithAnon = withFlareProfiler(Anon);
        render(<WithAnon />);
        expect(calls()[0]!.name).toBe('Unknown'); // '' falls through via ||, not ??
    });
});
