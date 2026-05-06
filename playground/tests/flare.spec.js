import { expect, test } from '@playwright/test';

import { checkFlareKeys } from './setup.js';

const FLARE_INGRESS = 'https://ingress.flareapp.io/v1/errors';

checkFlareKeys();

async function captureFlareReport(page) {
    const requestPromise = page.waitForRequest((req) => req.url() === FLARE_INGRESS && req.method() === 'POST');
    const responsePromise = page.waitForResponse(
        (res) => res.url() === FLARE_INGRESS && res.request().method() === 'POST'
    );

    return { requestPromise, responsePromise };
}

async function assertFlareReport(requestPromise, responsePromise, expectedMessage) {
    const [request, response] = await Promise.all([requestPromise, responsePromise]);

    // Validate request headers
    const headers = request.headers();
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-api-token']).toBeTruthy();
    expect(headers['x-flare-client-version']).toBe('1');

    // Validate request payload (V2 wire format)
    const payload = request.postDataJSON();
    expect(payload).toHaveProperty('seenAtUnixNano');
    expect(typeof payload.seenAtUnixNano).toBe('number');
    expect(payload.seenAtUnixNano).toBeGreaterThan(0);

    expect(payload).toHaveProperty('stacktrace');
    expect(Array.isArray(payload.stacktrace)).toBe(true);
    expect(payload.stacktrace.length).toBeGreaterThan(0);

    expect(payload).toHaveProperty('attributes');
    expect(payload.attributes['telemetry.sdk.language']).toBe('javascript');
    expect(payload.attributes['telemetry.sdk.name']).toBe('@flareapp/js');
    expect(payload.attributes['telemetry.sdk.version']).toBeTruthy();
    expect(payload.attributes['flare.language.name']).toBe('javascript');

    if (expectedMessage) {
        expect(payload.message).toContain(expectedMessage);
    }

    // Validate stackframe structure
    const frame = payload.stacktrace[0];
    expect(frame).toHaveProperty('file');
    expect(frame).toHaveProperty('lineNumber');
    expect(typeof frame.lineNumber).toBe('number');
    expect(frame).toHaveProperty('isApplicationFrame');

    // Validate response
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    return payload;
}

test.describe('JS client (@flareapp/js)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3001');
    });

    test('test connection sends valid report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('#test-connection');
        await assertFlareReport(requestPromise, responsePromise, 'The Flare client is set up correctly!');
    });

    test('manual error report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('#manual-report');
        await assertFlareReport(requestPromise, responsePromise, 'Manually reported error from JS playground');
    });

    test('error with custom context', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('#custom-context');
        const payload = await assertFlareReport(
            requestPromise,
            responsePromise,
            'Error with custom context from JS playground'
        );

        const custom = payload.attributes['context.custom'];
        expect(custom).toBeTruthy();
        expect(custom.playground).toBe('js');
        expect(custom.testId).toBeTruthy();
        expect(custom.user).toEqual({ name: 'Test User', email: 'test@example.com' });
    });

    test('report message', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('#report-message');
        await assertFlareReport(requestPromise, responsePromise, 'Test message from JS playground');
    });

    test('unhandled error gets reported', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('#unhandled-error');
        await assertFlareReport(requestPromise, responsePromise, 'Unhandled JS playground error');
    });
});

test.describe('React client (@flareapp/react)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3002');
    });

    test('test connection sends valid report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Test Connection")');
        await assertFlareReport(requestPromise, responsePromise, 'The Flare client is set up correctly!');
    });

    test('manual error report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Manual Error Report")');
        await assertFlareReport(requestPromise, responsePromise, 'Manually reported error from React playground');
    });

    test('error with custom context', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Error with Custom Context")');
        const payload = await assertFlareReport(
            requestPromise,
            responsePromise,
            'Error with custom context from React playground'
        );

        const custom = payload.attributes['context.custom'];
        expect(custom).toBeTruthy();
        expect(custom.playground).toBe('react');
        expect(custom.testId).toBeTruthy();
        expect(custom.user).toEqual({ name: 'Test User', email: 'test@example.com' });
    });

    test('report message', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Report Message")');
        await assertFlareReport(requestPromise, responsePromise, 'Test message from React playground');
    });

    test('component render error caught by ErrorBoundary', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Trigger Component Render Error")');
        const payload = await assertFlareReport(
            requestPromise,
            responsePromise,
            'React component render error from playground'
        );

        const custom = payload.attributes['context.custom'];
        expect(custom).toBeTruthy();
        expect(custom.react).toBeTruthy();
        expect(custom.react.componentStack).toBeInstanceOf(Array);
    });
});

test.describe('Vue client (@flareapp/vue)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:3003');
    });

    test('test connection sends valid report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Test Connection")');
        await assertFlareReport(requestPromise, responsePromise, 'The Flare client is set up correctly!');
    });

    test('manual error report', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Manual Error Report")');
        await assertFlareReport(requestPromise, responsePromise, 'Manually reported error from Vue playground');
    });

    test('error with custom context', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Error with Custom Context")');
        const payload = await assertFlareReport(
            requestPromise,
            responsePromise,
            'Error with custom context from Vue playground'
        );

        const custom = payload.attributes['context.custom'];
        expect(custom).toBeTruthy();
        expect(custom.playground).toBe('vue');
        expect(custom.testId).toBeTruthy();
        expect(custom.user).toEqual({ name: 'Test User', email: 'test@example.com' });
    });

    test('report message', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Report Message")');
        await assertFlareReport(requestPromise, responsePromise, 'Test message from Vue playground');
    });

    test('component render error caught by flareVue', async ({ page }) => {
        const { requestPromise, responsePromise } = await captureFlareReport(page);
        await page.click('button:has-text("Trigger Component Render Error")');
        const payload = await assertFlareReport(
            requestPromise,
            responsePromise,
            'Vue component render error from playground'
        );

        const custom = payload.attributes['context.custom'];
        expect(custom).toBeTruthy();
        expect(custom.vue).toBeTruthy();
        expect(custom.vue.componentName).toBeTruthy();
    });
});
