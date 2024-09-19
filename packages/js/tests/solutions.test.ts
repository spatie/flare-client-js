import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeHttp: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeHttp = new FakeApi();
    client = new Flare(fakeHttp).configure({
        key: 'key',
        debug: true,
    });
});

test('can register solution providers', () => {
    client.registerSolutionProvider({
        canSolve: () => false,
        getSolutions: () => [],
    });

    expect(client.solutionProviders).toHaveLength(1);
});

test('can use solution providers', async () => {
    client.registerSolutionProvider({
        canSolve: () => true,
        getSolutions: () => [
            {
                title: 'My solution',
                class: '',
                description: '',
                links: {},
            },
        ],
    });

    await client.report(new Error());

    expect(fakeHttp.lastReport?.solutions).toHaveLength(1);
    expect(fakeHttp.lastReport?.solutions[0]?.title).toBe('My solution');
});

test('can use async solution providers', async () => {
    client.registerSolutionProvider({
        canSolve: () => true,
        getSolutions: async () => [
            {
                title: 'My solution',
                class: '',
                description: '',
                links: {},
            },
        ],
    });

    await client.report(new Error());

    expect(fakeHttp.lastReport?.solutions).toHaveLength(1);
    expect(fakeHttp.lastReport?.solutions[0]?.title).toBe('My solution');
});

test('does not use solution providers that can not solve the error', async () => {
    client.registerSolutionProvider({
        canSolve: () => false,
        getSolutions: () => [
            {
                title: 'My solution',
                class: '',
                description: '',
                links: {},
            },
        ],
    });

    await client.report(new Error());

    expect(fakeHttp.lastReport?.solutions).toHaveLength(0);
});
