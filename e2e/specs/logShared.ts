import { expect, type Page } from '@playwright/test';

import { logCoverageFor, testIds, type Framework, type LogScenario } from '../../playgrounds/shared/src';
import type { FakeFlare, FakeFlareRecord } from '../fixtures/fake-flare';

type AnyValue = {
    stringValue?: string;
    intValue?: number;
    kvlistValue?: { values: KeyValue[] };
};
type KeyValue = { key: string; value: AnyValue };
type LogRecord = { body?: { stringValue?: string }; severityText?: string; attributes?: KeyValue[] };

const recordsIn = (record: FakeFlareRecord): LogRecord[] => {
    const env = record.bodyJson as { resourceLogs?: Array<{ scopeLogs?: Array<{ logRecords?: LogRecord[] }> }> } | null;
    return env?.resourceLogs?.flatMap((rl) => rl.scopeLogs?.flatMap((sl) => sl.logRecords ?? []) ?? []) ?? [];
};

const attr = (record: LogRecord, key: string): AnyValue | undefined =>
    record.attributes?.find((kv) => kv.key === key)?.value;

const kv = (value: AnyValue | undefined, key: string): AnyValue | undefined =>
    value?.kvlistValue?.values.find((entry) => entry.key === key)?.value;

export const runLogScenario = async (page: Page, fakeFlare: FakeFlare, scenario: LogScenario): Promise<void> => {
    const logPromise = fakeFlare.waitForLog({
        predicate: (rec) => recordsIn(rec).some((r) => r.body?.stringValue === scenario.message),
    });

    await page.getByTestId(testIds.logTrigger(scenario.id)).click();
    const received = await logPromise;

    const matching = recordsIn(received).filter((r) => r.body?.stringValue === scenario.message);
    expect(matching.length).toBe(scenario.count);
    expect(matching[0].severityText).toBe(scenario.level.toUpperCase());

    if (scenario.id === 'log-context') {
        const scope = attr(matching[0], 'context.scenario');
        expect(kv(scope, 'source')?.stringValue).toBe('logger');
        expect(kv(scope, 'userId')?.stringValue).toBe('usr_42');
    }
};

export const logScenariosFor = (framework: Framework): LogScenario[] => logCoverageFor(framework);
