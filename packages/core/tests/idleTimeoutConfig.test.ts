import { describe, expect, it } from 'vitest';

import { Flare } from '../src/Flare';
import { FakeApi } from './helpers/FakeApi';

describe('idle timeout config', () => {
    it('accepts idleTimeout / finalTimeout / childSpanTimeout via configure', () => {
        const flare = new Flare(new FakeApi());
        flare.configure({ idleTimeout: 500, finalTimeout: 10000, childSpanTimeout: 8000 });
        expect(flare.config.idleTimeout).toBe(500);
        expect(flare.config.finalTimeout).toBe(10000);
        expect(flare.config.childSpanTimeout).toBe(8000);
    });
});
