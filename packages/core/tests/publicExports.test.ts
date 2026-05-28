import { describe, expect, it } from 'vitest';

import { createStackTrace, getCodeSnippet, readLinesFromFile } from '../src';

describe('public exports from @flareapp/core', () => {
    it('exports createStackTrace as a function', () => {
        expect(typeof createStackTrace).toBe('function');
    });

    it('exports getCodeSnippet as a function', () => {
        expect(typeof getCodeSnippet).toBe('function');
    });

    it('exports readLinesFromFile as a function', () => {
        expect(typeof readLinesFromFile).toBe('function');
    });
});
