import { describe, expect, it } from 'vitest';

import { Flare } from '../src/Flare';
import { FakeApi } from './helpers/FakeApi';

describe('tracePropagationTargets config', () => {
    it('defaults to undefined and is overridable via configure', () => {
        const flare = new Flare(new FakeApi());
        expect(flare.config.tracePropagationTargets).toBeUndefined();

        flare.configure({ tracePropagationTargets: ['api.example.com', /\/graphql$/] });
        expect(flare.config.tracePropagationTargets).toHaveLength(2);
    });
});
