import { expect, test } from 'vitest';

import { Flare } from '../src';

test('light', () => {
    const client = new Flare();
    client.light('key');

    expect(client.config.key).toBe('key');
});

test('light() does not clobber a previously configured debug=true', () => {
    const client = new Flare();
    client.configure({ debug: true });
    client.light('key');

    expect(client.config.debug).toBe(true);
});

test('light() can still explicitly opt into debug', () => {
    const client = new Flare();
    client.light('key', true);

    expect(client.config.debug).toBe(true);
});
