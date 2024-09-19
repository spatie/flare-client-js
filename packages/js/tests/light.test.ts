import { expect, test } from 'vitest';

import { Flare } from '../src';

test('light', () => {
    const client = new Flare();
    client.light('key');

    expect(client.config.key).toBe('key');
});
