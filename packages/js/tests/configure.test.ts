import { expect, test } from 'vitest';

import { Flare } from '../src';

test('configure', () => {
    const client = new Flare();
    client.configure({ key: 'key' });

    expect(client.config.key).toBe('key');
});
