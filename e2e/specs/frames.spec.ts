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

// The fixture resets per test, so the first report is almost certainly ours. Match on the message
// anyway, the way every other spec here does: an unrelated error during hydration would otherwise send
// this looking at the wrong frames.
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

        // Asserting against the snippet rather than a hardcoded line number: the line moves whenever
        // broken.ts is edited, but "the frame points at the throwing line" is the property that matters
        // and it is what sourcemap resolution depends on.
        //
        // Match the whole throw, not the bare scenario id. The line directly above is the object key
        // `'sync-throw': () => {`, so a frame one line too high would satisfy a substring check on
        // `sync-throw` and this test would wave through exactly the defect it exists to catch.
        //
        // Quote-agnostic on purpose. The source is single-quoted but this snippet is what the browser
        // fetched, which is Vite's transformed output, and that is double-quoted today.
        expect(top.codeSnippet[String(top.lineNumber)]).toMatch(/throw new Error\(['"]sync-throw['"]\)/);
    });
});
