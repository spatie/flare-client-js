import { testIds } from '../../playgrounds/shared/src';
import type { FakeFlareRecord } from '../fixtures/fake-flare';
import { expect, test } from '../fixtures/fake-flare';

type Frame = {
    file: string;
    method: string;
    lineNumber: number;
    columnNumber: number;
    isApplicationFrame: boolean;
    codeSnippet: Record<string, string>;
};

// Match on the message rather than just taking the first report, so an unrelated hydration
// error doesn't send this looking at the wrong frames.
const isSyncThrow = (record: FakeFlareRecord): boolean =>
    (record.bodyJson as { message?: string }).message === 'sync-throw';

test.describe('stack frames', () => {
    test('the top frame points at the line that threw', async ({ page, fakeFlare }) => {
        await page.goto('/broken');
        await page.waitForLoadState('networkidle');
        await page.getByTestId(testIds.brokenTrigger('sync-throw')).click();

        const report = await fakeFlare.waitForReport({ timeout: 9000, predicate: isSyncThrow });
        const frames = (report.bodyJson as { stacktrace?: Frame[] }).stacktrace ?? [];
        const top = frames[0];

        expect(top).toBeTruthy();
        expect(top.file).toContain('/src/pages/broken.ts');
        expect(top.isApplicationFrame).toBe(true);

        // Assert against the snippet, not a hardcoded line number, since the line moves whenever
        // broken.ts is edited. Match the whole throw, not the bare scenario id: the line above is
        // the object key `'sync-throw': () => {`, so a frame one line too high would still pass a
        // substring check on just `sync-throw`. Quotes are agnostic on purpose: the source is
        // single-quoted, but Vite's transformed output the browser fetches is double-quoted.
        expect(top.codeSnippet[String(top.lineNumber)]).toMatch(/throw new Error\(['"]sync-throw['"]\)/);
    });
});
