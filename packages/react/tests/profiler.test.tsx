// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createRef, StrictMode, Suspense, type ReactNode, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(async () => (await import('@flareapp/test-helpers')).createComponentSeam());
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).componentProfilerMock(await seam, await importOriginal()),
);

import { FlareProfiler, withFlareProfiler } from '../src/profiler';

const fake = await seam;

beforeEach(() => {
    fake.reset();
});
afterEach(cleanup);

// Reads the recorded arguments rather than the fake's span log: the withFlareProfiler test isolates
// three renders with recordComponentSpan.mockClear(), which empties mock.calls but not the log.
const calls = () =>
    fake.recordComponentSpan.mock.calls.map(
        (c) =>
            c[0] as {
                name: string;
                spanId: string;
                parent: { traceId: string; parentSpanId: string };
                startTimeUnixNano: number;
                endTimeUnixNano: number;
            },
    );

describe('FlareProfiler', () => {
    it('records one span for a single component, parented to the active root', () => {
        render(
            <FlareProfiler name="Solo">
                <div>content</div>
            </FlareProfiler>,
        );
        expect(fake.recordComponentSpan).toHaveBeenCalledTimes(1);
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
        fake.setRoot(null);
        const { getByText } = render(
            <FlareProfiler name="Solo">
                <div>still here</div>
            </FlareProfiler>,
        );
        expect(fake.recordComponentSpan).not.toHaveBeenCalled();
        expect(fake.reserveSpanId).not.toHaveBeenCalled();
        expect(getByText('still here')).toBeTruthy();
    });

    it('never throws when the seam throws', () => {
        fake.recordComponentSpan.mockImplementation(() => {
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
        fake.activeComponentRoot.mockImplementation(() => {
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
        fake.reserveSpanId.mockImplementation(() => {
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
        expect(fake.recordComponentSpan).not.toHaveBeenCalled();
    });

    it('records exactly once under StrictMode (no duplicate spanId)', () => {
        render(
            <StrictMode>
                <FlareProfiler name="Solo">
                    <div>x</div>
                </FlareProfiler>
            </StrictMode>,
        );
        expect(fake.recordComponentSpan).toHaveBeenCalledTimes(1);
    });

    it('records a suspended child under its profiled ancestor once it resolves', async () => {
        let resolve!: () => void;
        const gate = new Promise<void>((r) => {
            resolve = r;
        });
        let ready = false;
        const Suspender = () => {
            if (!ready) {
                throw gate;
            }
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

    it('re-homes a descendant to the live root when the inherited ancestor context is from a dead trace', () => {
        // Ancestor (a persistent layout) mounts under the initial pageload trace R1.
        fake.setRoot({ traceId: 'R1', parentSpanId: 'r1root' });
        const { rerender } = render(<FlareProfiler name="Layout">{null}</FlareProfiler>);

        // Pageload trace R1 closes; a client navigation opens a fresh trace R2. The ancestor
        // does NOT remount (rerender, same fiber), so its provided context stays frozen at R1.
        fake.setRoot({ traceId: 'R2', parentSpanId: 'r2root' });
        rerender(
            <FlareProfiler name="Layout">
                <FlareProfiler name="Descendant">
                    <div>x</div>
                </FlareProfiler>
            </FlareProfiler>,
        );

        const byName = Object.fromEntries(calls().map((c) => [c.name, c]));
        // Ancestor recorded once, under its own live trace at mount time (R1).
        expect(byName.Layout).toMatchObject({ parent: { traceId: 'R1', parentSpanId: 'r1root' } });
        // Descendant inherited the stale R1 context but RE-HOMES to the live R2 root instead of
        // pinning to the dead trace (which the live-root gate would drop in production).
        expect(byName.Descendant).toMatchObject({ parent: { traceId: 'R2', parentSpanId: 'r2root' } });
    });

    it('reads the clock twice, so a recorded span has a real duration', () => {
        // The frozen default clock makes every timestamp the same constant, which cannot tell two
        // reads apart from one value used twice. Advance it and the start/end split becomes testable.
        fake.advanceClock();

        render(
            <FlareProfiler name="Solo">
                <div>x</div>
            </FlareProfiler>,
        );

        const span = calls()[0]!;
        expect(span.endTimeUnixNano).toBeGreaterThan(span.startTimeUnixNano);
    });

    it('is transparent when it could not reserve a span: the descendant nests under the ancestor above', () => {
        // A live root, but the id reservation fails for the middle one, so it publishes no context.
        // It used to publish null and push the descendant back onto the root, skipping the ancestor.
        fake.reserveSpanId
            .mockImplementationOnce(() => 'a1')
            .mockImplementationOnce(() => {
                throw new Error('boom');
            });

        render(
            <FlareProfiler name="Ancestor">
                <FlareProfiler name="Middle">
                    <FlareProfiler name="Leaf">
                        <div>x</div>
                    </FlareProfiler>
                </FlareProfiler>
            </FlareProfiler>,
        );

        const byName = Object.fromEntries(calls().map((c) => [c.name, c]));
        expect(byName.Middle).toBeUndefined();
        expect(byName.Leaf).toMatchObject({ parent: { parentSpanId: 'a1' } }); // Ancestor, not the root
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

        fake.recordComponentSpan.mockClear();
        const Displayed = () => <div>d</div>;
        Displayed.displayName = 'Display';
        const WithDisplayName = withFlareProfiler(Displayed);
        render(<WithDisplayName />);
        expect(calls()[0]!.name).toBe('Display'); // displayName beats Component.name ('Displayed')

        fake.recordComponentSpan.mockClear();
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

    it('sets a displayName that names the wrapped component', () => {
        const Named = () => <div>n</div>;
        expect(withFlareProfiler(Named).displayName).toBe('withFlareProfiler(Named)');
        expect(withFlareProfiler(Named, { name: 'Explicit' }).displayName).toBe('withFlareProfiler(Explicit)');
    });

    it('forwards a ref through the wrapper on React 19, where ref is a normal prop', () => {
        const Input = (props: { ref?: Ref<HTMLInputElement> }) => <input ref={props.ref} />;
        const Profiled = withFlareProfiler(Input, { name: 'Input' });
        const ref = createRef<HTMLInputElement>();

        render(<Profiled ref={ref} />);

        expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
});
