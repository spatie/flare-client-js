import { expect, test } from '../fixtures/fake-flare';
import type { FakeFlareRecord } from '../fixtures/fake-flare';

// This suite runs only against a PRODUCTION build of the React playground
// (E2E_PROD=1, served via `vite preview`). A development React build emits full
// error messages, so the minified-error decode path can only be exercised here,
// where react-dom throws a genuine "Minified React error #NNN; visit
// https://react.dev/errors/NNN ..." for an internal invariant.

type ReactContext = {
    version?: unknown;
    minifiedError?: { number?: unknown; args?: unknown; url?: unknown };
};

const reactContextOf = (record: FakeFlareRecord): ReactContext | undefined => {
    const body = record.bodyJson as { attributes?: Record<string, unknown> } | null;
    const custom = body?.attributes?.['context.custom'] as { react?: ReactContext } | undefined;
    return custom?.react;
};

test.describe('react playground (production build)', () => {
    test('decodes a genuine minified React error into structured context', async ({ page, fakeFlare }) => {
        await page.goto('/react-invariant');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('trigger-react-invariant-hooks').click();

        const report = await fakeFlare.waitForReport({
            timeout: 10_000,
            predicate: (record) => Boolean(reactContextOf(record)?.minifiedError),
        });

        const react = reactContextOf(report);
        const minifiedError = react?.minifiedError;

        // The error originated from production react-dom, not an injected message:
        // a positive error number and the canonical react.dev errors URL.
        expect(typeof minifiedError?.number).toBe('number');
        expect(minifiedError?.number as number).toBeGreaterThan(0);
        expect(String(minifiedError?.url)).toMatch(/react\.dev\/errors\/\d+/);
        expect(Array.isArray(minifiedError?.args)).toBe(true);

        // The running React version travels alongside so the backend can pick the
        // matching error-code map.
        expect(typeof react?.version).toBe('string');
        expect(String(react?.version).length).toBeGreaterThan(0);
    });
});
