import { describe, expect, it, vi } from 'vitest';

vi.mock('@flareapp/react/inject', () => ({
    FlareErrorBoundary: (props: Record<string, unknown>) => ({ type: 'InjectBoundary', props }),
}));

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';
import { flare } from '../src/singleton';

type MockEl = { props: { flare: unknown; children: unknown; fallback?: unknown } };

describe('FlareErrorBoundary wrapper', () => {
    it('injects the RN singleton as the flare prop and forwards other props', () => {
        const sentinelChildren = { sentinel: true };
        const fallback = () => null;
        const el = FlareErrorBoundary({ children: sentinelChildren, fallback } as never) as unknown as MockEl;
        expect(el.props.flare).toBe(flare);
        // The `...props` spread must forward consumer props (regression guard:
        // dropping the spread would still pass the flare assertion above).
        expect(el.props.children).toBe(sentinelChildren);
        expect(el.props.fallback).toBe(fallback);
    });

    it('a consumer cannot override the injected flare (singleton wins)', () => {
        const rogue = {} as never;
        const el = FlareErrorBoundary({ children: null, flare: rogue } as never) as unknown as {
            props: { flare: unknown };
        };
        expect(el.props.flare).toBe(flare);
    });
});
