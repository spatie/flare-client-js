import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { NoopFlushScheduler } from '../src/logging/FlushScheduler';
import { Logger } from '../src/logging/Logger';
import type { Attributes, Config, Framework, SdkInfo } from '../src/types';
import { FakeApi } from './helpers/FakeApi';

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

describe('Logger flush', () => {
    it('sends a buffered log to /v1/logs with the key', () => {
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ logFlushIntervalMs: 999_999 }), api);
        logger.info('hello');
        logger.flush();
        expect(api.logEnvelopes).toHaveLength(1);
        expect(api.lastLogUrl).toBe('https://ingress.test/v1/logs');
        expect(api.lastLogKey).toBe('KEY');
        const rec = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(rec.body).toEqual({ stringValue: 'hello' });
    });

    it('does not send when there is no key, but retains the buffer', () => {
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ key: null, logFlushIntervalMs: 999_999 }), api);
        logger.info('hello');
        logger.flush();
        expect(api.logEnvelopes).toHaveLength(0);
        expect(logger.bufferLength()).toBe(1);
    });

    it('emits identity resource attributes', () => {
        const api = new FakeApi();
        const logger = makeLogger(
            makeConfig({ serviceName: 'svc', version: '1.2.3', logFlushIntervalMs: 999_999 }),
            api,
        );
        logger.info('hello');
        logger.flush();
        const attrs = api.logEnvelopes[0].resourceLogs[0].resource.attributes;
        const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]));
        expect(byKey['service.name']).toEqual({ stringValue: 'svc' });
        expect(byKey['service.version']).toEqual({ stringValue: '1.2.3' });
        expect(byKey['telemetry.sdk.name']).toEqual({ stringValue: '@flareapp/core' });
    });

    it('clears the buffer on clear()', () => {
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ logFlushIntervalMs: 999_999 }), api);
        logger.info('hello');
        logger.clear();
        expect(logger.bufferLength()).toBe(0);
        logger.flush();
        expect(api.logEnvelopes).toHaveLength(0);
    });
});

describe('Logger triggers', () => {
    it('flushes when the buffer reaches maxLogBufferSize', () => {
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ maxLogBufferSize: 3, logFlushIntervalMs: 999_999 }), api);
        logger.info('a');
        logger.info('b');
        expect(api.logEnvelopes).toHaveLength(0);
        logger.info('c');
        expect(api.logEnvelopes).toHaveLength(1);
        expect(logger.bufferLength()).toBe(0);
    });

    it('flushes on the timer', () => {
        vi.useFakeTimers();
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ logFlushIntervalMs: 5000 }), api);
        logger.info('a');
        expect(api.logEnvelopes).toHaveLength(0);
        vi.advanceTimersByTime(5000);
        expect(api.logEnvelopes).toHaveLength(1);
        vi.useRealTimers();
    });

    it('teardown ships the smaller records and retains the over-keepalive one', () => {
        const api = new FakeApi();
        const logger = makeLogger(
            makeConfig({ keepaliveMaxBytes: 2000, logFlushMaxBytes: 1_000_000, logFlushIntervalMs: 999_999 }),
            api,
        );
        logger.info('small-1');
        logger.info('x'.repeat(5000)); // > keepaliveMaxBytes, < logFlushMaxBytes
        logger.info('small-2');
        logger.flush({ keepalive: true });
        expect(api.logEnvelopes).toHaveLength(1);
        expect(api.lastLogKeepalive).toBe(true);
        const bodies = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords.map((r) => r.body);
        expect(bodies).toContainEqual({ stringValue: 'small-1' });
        expect(bodies).toContainEqual({ stringValue: 'small-2' });
        expect(bodies.some((b) => 'stringValue' in b && b.stringValue.length > 1000)).toBe(false);
        // The over-budget record is not dropped — a backgrounded tab may resume.
        expect(logger.bufferLength()).toBe(1);
    });

    it('backgrounded tab keeps over-keepalive records and ships them on a later normal flush', () => {
        const api = new FakeApi();
        const logger = makeLogger(
            makeConfig({ keepaliveMaxBytes: 2000, logFlushMaxBytes: 1_000_000, logFlushIntervalMs: 999_999 }),
            api,
        );
        logger.info('x'.repeat(5000)); // > keepaliveMaxBytes, < logFlushMaxBytes

        // visibilitychange:hidden on a backgrounded (not unloading) tab. Nothing fits
        // the keepalive budget, so no envelope ships and the record must survive.
        logger.flush({ keepalive: true });
        expect(api.logEnvelopes).toHaveLength(0);
        expect(logger.bufferLength()).toBe(1);

        // Tab resumes; a normal flush ships the retained record.
        logger.flush();
        expect(api.logEnvelopes).toHaveLength(1);
        expect(api.lastLogKeepalive).toBe(false);
        const bodies = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords.map((r) => r.body);
        expect(bodies.some((b) => 'stringValue' in b && b.stringValue.length > 1000)).toBe(true);
        expect(logger.bufferLength()).toBe(0);
    });

    it('teardown envelope stays under keepaliveMaxBytes by actual serialized bytes', () => {
        const api = new FakeApi();
        const config = makeConfig({
            keepaliveMaxBytes: 1500,
            logFlushMaxBytes: 1_000_000,
            logFlushIntervalMs: 999_999,
        });
        const logger = makeLogger(config, api);
        for (let i = 0; i < 30; i++) logger.info('x'.repeat(200)); // each ~200B; 30 would blow 1500B
        logger.flush({ keepalive: true });
        expect(api.logEnvelopes).toHaveLength(1);
        const serialized = new TextEncoder().encode(JSON.stringify(api.logEnvelopes[0])).length;
        expect(serialized).toBeLessThanOrEqual(1500);
    });

    it('weight cap flushes-and-clears with a key (ships, does not trim away)', () => {
        const api = new FakeApi();
        // logFlushMaxBytes chosen so a SINGLE record stays under it (no oversized
        // drop at capture), but TWO cross it — so the 2nd push fires the weight
        // trigger. Each ~250-char message serializes to ~380B incl. envelope keys.
        const logger = makeLogger(
            makeConfig({ logFlushMaxBytes: 700, maxLogBufferSize: 100, logFlushIntervalMs: 999_999 }),
            api,
        );
        logger.info('x'.repeat(250));
        logger.info('y'.repeat(250));
        expect(api.logEnvelopes.length).toBeGreaterThanOrEqual(1);
        expect(logger.bufferLength()).toBe(0); // shipped, not silently trimmed
    });

    it('clear() resets the timer so a later record re-arms it', () => {
        vi.useFakeTimers();
        const api = new FakeApi();
        const logger = makeLogger(makeConfig({ logFlushIntervalMs: 5000 }), api);
        logger.info('a'); // arms the timer
        logger.clear(); // disable transition clears buffer + timer flag
        logger.info('b'); // must re-arm
        vi.advanceTimersByTime(5000);
        expect(api.logEnvelopes).toHaveLength(1); // the re-armed timer fired
        vi.useRealTimers();
    });

    it('reads SDK identity lazily at flush (not snapshotted at construction)', () => {
        const api = new FakeApi();
        const sdkInfo = { name: '@flareapp/core', version: '0.0.0' };
        const config = makeConfig({ logFlushIntervalMs: 999_999 });
        const logger = new Logger({
            api,
            getConfig: () => config,
            getSdkInfo: () => sdkInfo,
            getFramework: () => null,
            buildLogAttributes: (u) => ({ record: { ...u }, resource: {} }),
            track: (p) => p,
            scheduler: new NoopFlushScheduler(),
        });
        logger.info('a');
        sdkInfo.name = '@flareapp/js'; // changes after construction (mirrors setSdkInfo)
        logger.flush();
        expect(api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].scope.name).toBe('@flareapp/js');
    });
});
