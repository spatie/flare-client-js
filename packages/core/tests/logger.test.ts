import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { NoopFlushScheduler } from '../src/logging/FlushScheduler';
import { Logger } from '../src/logging/Logger';
import type { Attributes, Config, Framework, SdkInfo } from '../src/types';

function makeConfig(overrides: Partial<Config> = {}): Config {
    return {
        key: 'KEY',
        version: '',
        sourcemapVersionId: '',
        stage: '',
        maxGlowsPerReport: 30,
        ingestUrl: 'https://ingress.test/v1/errors',
        reportBrowserExtensionErrors: false,
        debug: false,
        urlDenylist: /(?:)/,
        replaceDefaultUrlDenylist: false,
        sampleRate: 1,
        beforeEvaluate: (e) => e,
        beforeSubmit: (r) => r,
        enableLogs: true,
        logsIngestUrl: 'https://ingress.test/v1/logs',
        maxLogBufferSize: 100,
        logFlushIntervalMs: 5000,
        logFlushMaxBytes: 800_000,
        keepaliveMaxBytes: 60_000,
        ...overrides,
    };
}

function makeLogger(config: Config, api: Api = new Api()) {
    const sdkInfo: SdkInfo = { name: '@flareapp/core', version: '0.0.0' };
    const framework: Framework | null = null;
    return new Logger({
        api,
        getConfig: () => config,
        getSdkInfo: () => sdkInfo,
        getFramework: () => framework,
        buildLogAttributes: (userAttributes: Attributes) => ({ record: { ...userAttributes }, resource: {} }),
        track: (p) => p,
        scheduler: new NoopFlushScheduler(),
    });
}

describe('Logger record/buffer', () => {
    beforeEach(() => vi.useRealTimers());

    it('does not buffer when enableLogs is false', () => {
        const logger = makeLogger(makeConfig({ enableLogs: false }));
        logger.info('hi');
        expect(logger.bufferLength()).toBe(0);
    });

    it('drops records below minimumLogLevel', () => {
        const logger = makeLogger(makeConfig({ minimumLogLevel: 'warning' }));
        logger.info('low');
        logger.error('high');
        expect(logger.bufferLength()).toBe(1);
    });

    it('drops a single record larger than logFlushMaxBytes at capture', () => {
        // Cap sits above a minimal record's serialized size (~140B incl. timestamp,
        // severity, empty attribute maps) but below the 500-char record (~640B), so
        // only the big one is dropped at capture.
        const logger = makeLogger(makeConfig({ logFlushMaxBytes: 300, maxLogBufferSize: 100 }));
        logger.info('x'.repeat(500));
        expect(logger.bufferLength()).toBe(0);
        logger.info('ok');
        expect(logger.bufferLength()).toBe(1);
    });

    it('trims oldest records past maxLogBufferSize (keyless, so the count-cap flush no-ops)', () => {
        // With a key, hitting the count cap would flush-and-clear, so the buffer
        // would never accumulate to the cap. key: null makes flush no-op, so the
        // hard trim is what bounds the buffer — which is exactly what we assert.
        const logger = makeLogger(makeConfig({ key: null, maxLogBufferSize: 3, logFlushIntervalMs: 999_999 }));
        for (let i = 0; i < 10; i++) logger.info(`m${i}`);
        expect(logger.bufferLength()).toBe(3);
    });
});
