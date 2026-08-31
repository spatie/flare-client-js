import { expect, test } from '../fixtures/fake-flare';
import type { FakeFlareRecord } from '../fixtures/fake-flare';

// Runs only against a PRODUCTION build (E2E_PROD=1, via `vite preview`). A dev build emits full
// error messages, so the minified-error decode path can only be exercised here.

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

        // Proves the error came from production react-dom, not an injected message.
        expect(typeof minifiedError?.number).toBe('number');
        expect(minifiedError?.number as number).toBeGreaterThan(0);
        expect(String(minifiedError?.url)).toMatch(/react\.dev\/errors\/\d+/);
        expect(Array.isArray(minifiedError?.args)).toBe(true);

        // The React version travels in the field so the backend can pick the matching error-code map.
        expect(typeof minifiedError?.react_version).toBe('string');
        expect(String(minifiedError?.react_version).length).toBeGreaterThan(0);
    });
});
