import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { runScenario, scenariosFor } from './shared';

test.describe('vue playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.getByTestId(testIds.addToCart('p01')).click();
        await page.getByRole('link', { name: 'Cart' }).click();
        await expect(page.getByTestId(testIds.cartItem('p01'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('vue')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });
});
