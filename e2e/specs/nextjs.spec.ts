import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { runScenario, scenariosFor } from './shared';

test.describe('nextjs playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('react')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                // initFlare runs from a useEffect in FlareProvider, so the window handlers are only
                // attached after hydration. Clicking before that silently reports nothing.
                await page.waitForLoadState('networkidle');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });
});
