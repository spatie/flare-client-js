import { expect, test } from '../fixtures/fake-flare';
import type { FakeFlareRecord } from '../fixtures/fake-flare';

// This suite runs only against a PRODUCTION build of the React playground
// (E2E_PROD=1, served via `vite preview`). A development React build emits full
// error messages, so the minified-error decode path can only be exercised here,
// where react-dom throws a genuine "Minified React error #NNN; visit
// https://react.dev/errors/NNN ..." for an internal invariant.

type MinifiedErrorField = {
    number?: unknown;
    args?: unknown;
    url?: unknown;
    react_version?: unknown;
};

const minifiedErrorOf = (record: FakeFlareRecord): MinifiedErrorField | undefined => {
    const body = record.bodyJson as { attributes?: Record<string, unknown> } | null;
    return body?.attributes?.['flare.exception.react_minified_error'] as MinifiedErrorField | undefined;
};

test.describe('react playground (production build)', () => {
    test('decodes a genuine minified React error into the flare.exception field', async ({ page, fakeFlare }) => {
        await page.goto('/react-invariant');
        await page.waitForLoadState('networkidle');

        await page.getByTestId('trigger-react-invariant-hooks').click();

        const report = await fakeFlare.waitForReport({
            timeout: 10_000,
            predicate: (record) => Boolean(minifiedErrorOf(record)),
        });

        const minifiedError = minifiedErrorOf(report);

        // The error originated from production react-dom, not an injected message:
        // a positive error number and the canonical react.dev errors URL.
        expect(typeof minifiedError?.number).toBe('number');
        expect(minifiedError?.number as number).toBeGreaterThan(0);
        expect(String(minifiedError?.url)).toMatch(/react\.dev\/errors\/\d+/);
        expect(Array.isArray(minifiedError?.args)).toBe(true);

        // The running React version travels inside the field so the backend can pick
        // the matching error-code map.
        expect(typeof minifiedError?.react_version).toBe('string');
        expect(String(minifiedError?.react_version).length).toBeGreaterThan(0);
    });
});
