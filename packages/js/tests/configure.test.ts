import { expect, test } from 'vitest';

import { Flare } from '../src';

test('configure merges over defaults', () => {
    const client = new Flare();
    client.configure({ key: 'key', ingestUrl: 'https://example.test/v1/errors' });

    expect(client.config.key).toBe('key');
    expect(client.config.ingestUrl).toBe('https://example.test/v1/errors');
});

test('default ingestUrl points to production', () => {
    const client = new Flare();
    expect(client.config.ingestUrl).toBe('https://ingress.flareapp.io/v1/errors');
});
