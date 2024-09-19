import { Flare } from '../src';
import { expect, test } from 'vitest';

test('light', () => {
    const client = new Flare();
    client.light('key');

    expect(client.config.key).toBe('key');
});
