import { describe, expect, it } from 'vitest';

import { partitionAttributes } from '../src/logging/partition';

describe('partitionAttributes', () => {
    it('routes resource-prefixed keys to resource, everything else to record', () => {
        const { resource, record } = partitionAttributes({
            'process.pid': 1,
            'host.name': 'h',
            'service.version': '1.0',
            'http.request.method': 'GET',
            'enduser.id': '42',
            'client.address': '1.2.3.4',
            'user_agent.original': 'UA',
            'flare.entry_point.type': 'server',
            'context.custom': { a: 1 },
        });

        expect(resource).toEqual({
            'process.pid': 1,
            'host.name': 'h',
            'service.version': '1.0',
        });
        expect(record).toEqual({
            'http.request.method': 'GET',
            'enduser.id': '42',
            'client.address': '1.2.3.4',
            'user_agent.original': 'UA',
            'flare.entry_point.type': 'server',
            'context.custom': { a: 1 },
        });
    });

    it('defaults unknown keys to record level', () => {
        const { resource, record } = partitionAttributes({ 'something.new': 1 });
        expect(resource).toEqual({});
        expect(record).toEqual({ 'something.new': 1 });
    });

    it('keeps process.uptime record-level despite the process. prefix', () => {
        const { resource, record } = partitionAttributes({ 'process.pid': 1, 'process.uptime': 12.3 });
        expect(resource).toEqual({ 'process.pid': 1 });
        expect(record).toEqual({ 'process.uptime': 12.3 });
    });
});
