import { describe, expect, it, vi } from 'vitest';

vi.mock('@flareapp/react/inject', () => ({
    FlareErrorBoundary: (props: Record<string, unknown>) => ({ type: 'InjectBoundary', props }),
}));

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';
import { flare } from '../src/singleton';

describe('FlareErrorBoundary wrapper', () => {
    it('injects the RN singleton as the flare prop', () => {
        const el = FlareErrorBoundary({ children: null }) as unknown as {
            props: { flare: unknown };
        };
        expect(el.props.flare).toBe(flare);
    });

    it('a consumer cannot override the injected flare (singleton wins)', () => {
        const rogue = {} as never;
        const el = FlareErrorBoundary({ children: null, flare: rogue } as never) as unknown as {
            props: { flare: unknown };
        };
        expect(el.props.flare).toBe(flare);
    });
});
