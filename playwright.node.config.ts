import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e/node-frameworks',
    timeout: 30_000,
    retries: 0,
    fullyParallel: false,
    workers: 1,
    // Separate output dirs from the browser config so a same-job run of both
    // suites in CI doesn't clobber each other's HTML report / test-results.
    outputDir: 'test-results-node',
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-node' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    projects: [
        {
            name: 'node-frameworks',
            testMatch: /context\.spec\.ts$/,
        },
    ],
});
