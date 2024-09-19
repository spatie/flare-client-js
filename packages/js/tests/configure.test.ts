import { Flare } from '../src';
import { expect, test } from 'vitest';

test('configure', () => {
    const client = new Flare();
    client.configure({ key: 'key' });

    expect(client.config.key).toBe('key');
});
