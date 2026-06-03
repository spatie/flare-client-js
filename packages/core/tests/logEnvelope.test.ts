import { describe, expect, it } from 'vitest';

import { buildLogsEnvelope } from '../src/logging/envelope';
import type { BufferedLog } from '../src/types';

const record: BufferedLog = {
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    severityText: 'INFO',
    message: 'hello',
    recordAttributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }],
    resourceAttributes: {},
};

describe('buildLogsEnvelope', () => {
    it('builds an OTel resourceLogs envelope', () => {
        const envelope = buildLogsEnvelope([record], { 'service.name': 'svc' }, '@flareapp/js', '2.0.0');

        expect(envelope.resourceLogs).toHaveLength(1);
        const rl = envelope.resourceLogs[0];
        expect(rl.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'svc' } }]);
        expect(rl.resource.droppedAttributesCount).toBe(0);

        const sl = rl.scopeLogs[0];
        expect(sl.scope).toEqual({ name: '@flareapp/js', version: '2.0.0', attributes: [], droppedAttributesCount: 0 });

        expect(sl.logRecords).toHaveLength(1);
        expect(sl.logRecords[0]).toEqual({
            timeUnixNano: '1700000000000000000',
            observedTimeUnixNano: '1700000000000000000',
            severityNumber: 9,
            severityText: 'INFO',
            body: { stringValue: 'hello' },
            attributes: [{ key: 'http.request.method', value: { stringValue: 'GET' } }],
            flags: 0,
            droppedAttributesCount: 0,
        });
    });
});
