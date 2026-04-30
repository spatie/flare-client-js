// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Api } from '../src/api/Api';
import { mapToV2Wire } from '../src/api/mapToV2Wire';
import { Config, Report } from '../src/types';

const config: Config = {
    key: 'secret-key',
    version: '1.0.0',
    sourcemapVersion: 'v3',
    stage: 'production',
    maxGlowsPerReport: 30,
    reportBrowserExtensionErrors: false,
    reportingUrl: 'https://ingress.flareapp.io/v1/errors',
    debug: false,
    beforeEvaluate: (e) => e,
    beforeSubmit: (r) => r,
};

function minimalReport(): Report {
    return {
        notifier: 'n',
        exception_class: 'Error',
        seen_at: 1,
        message: 'm',
        language: 'javascript',
        glows: [],
        context: {},
        stacktrace: [],
        sourcemap_version_id: 'v3',
        solutions: [],
        stage: 'production',
    };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ status: 201 });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

test('POSTs to config.reportingUrl', async () => {
    await new Api().report(minimalReport(), config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ingress.flareapp.io/v1/errors');
});

test('sends the v2 headers', async () => {
    await new Api().report(minimalReport(), config);

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual({
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Token': 'secret-key',
        'X-Report-Browser-Extension-Errors': 'false',
        'X-Flare-Client-Version': '1',
    });
});

test('does not send X-Requested-With', async () => {
    await new Api().report(minimalReport(), config);

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).not.toHaveProperty('X-Requested-With');
});

test('forwards reportBrowserExtensionErrors as JSON-encoded header', async () => {
    await new Api().report(minimalReport(), { ...config, reportBrowserExtensionErrors: true });

    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as any)['X-Report-Browser-Extension-Errors']).toBe('true');
});

test('body is the v2 wire payload from mapToV2Wire', async () => {
    const report = minimalReport();
    await new Api().report(report, config);

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string);

    expect(body).toEqual(JSON.parse(JSON.stringify(mapToV2Wire(report, config))));
});

test('uses POST', async () => {
    await new Api().report(minimalReport(), config);

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
});

test('logs error on unexpected response status', async () => {
    fetchMock.mockResolvedValueOnce({ status: 500 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await new Api().report(minimalReport(), config);

    expect(consoleError).toHaveBeenCalledWith('Received response with status 500 from Flare');
    consoleError.mockRestore();
});

test.each([200, 201, 204])('does not log on %i', async (status) => {
    fetchMock.mockResolvedValueOnce({ status });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await new Api().report(minimalReport(), config);

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
});

test('sends empty string for X-Api-Token when key is null', async () => {
    await new Api().report(minimalReport(), { ...config, key: null });

    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as any)['X-Api-Token']).toBe('');
});
