import { describe, expect, it } from 'vitest';

import * as core from '../src';
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

describe('tracing public exports', () => {
    it('exposes the tracing surface from the package entry', () => {
        expect(typeof core.Tracer).toBe('function');
        expect(typeof core.InMemoryActiveSpanHolder).toBe('function');
        expect(typeof core.buildTracesEnvelope).toBe('function');
        expect(typeof core.buildTraceparent).toBe('function');
        expect(typeof core.parseTraceparent).toBe('function');
    });
});
