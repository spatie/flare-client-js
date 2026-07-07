import { compile, preprocess } from 'svelte/compiler';
import { describe, expect, test } from 'vitest';

import { withFlareConfig } from '../src/config.js';
import { flarePreprocessor } from '../src/preprocessor.js';

const FAKE_FILE = '/app/src/Button.svelte';
const SCRIPT_ATTRS = { lang: undefined };

// Run the script hook (component with <script>).
function runScriptHook(pp: ReturnType<typeof flarePreprocessor>, filename = FAKE_FILE) {
    const result = (pp as any).script({ content: 'console.log("hi");', filename, attributes: SCRIPT_ATTRS });
    return result;
}

// Run the markup hook (no <script> tag, scriptless component).
function runMarkupHook(pp: ReturnType<typeof flarePreprocessor>, filename = FAKE_FILE) {
    const result = (pp as any).markup({ content: '<p>hello</p>', filename });
    return result;
}

describe('flarePreprocessor — importSource option', () => {
    describe('script branch (component with <script>)', () => {
        test('defaults to importing from @flareapp/svelte (web)', () => {
            const pp = flarePreprocessor();
            const out = runScriptHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = runScriptHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });

    describe('markup branch (scriptless component)', () => {
        test('defaults to importing from @flareapp/svelte (web)', () => {
            const pp = flarePreprocessor();
            const out = runMarkupHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte'");
            expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
        });

        test('emits the inject specifier when importSource is @flareapp/svelte/inject', () => {
            const pp = flarePreprocessor({ importSource: '@flareapp/svelte/inject' });
            const out = runMarkupHook(pp);
            expect(out.code).toContain("from '@flareapp/svelte/inject'");
            expect(out.code).not.toContain("from '@flareapp/svelte'");
        });
    });
});

describe('withFlareConfig — importSource option', () => {
    test('threads importSource through to the preprocessor (script branch)', () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('threads importSource through to the preprocessor (markup branch)', () => {
        const cfg = withFlareConfig({}, { importSource: '@flareapp/svelte/inject' });
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).markup({ content: '<p>hello</p>', filename: FAKE_FILE });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
    });

    test('default (no importSource) still emits @flareapp/svelte', () => {
        const cfg = withFlareConfig({});
        const preprocessors = Array.isArray(cfg.preprocess) ? cfg.preprocess : [cfg.preprocess!];
        const pp = preprocessors[0];
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.code).toContain("from '@flareapp/svelte'");
        expect(out.code).not.toContain("from '@flareapp/svelte/inject'");
    });
});

// Run through Svelte's real pipeline (markup -> script in one pass), not the hooks in isolation.
// Only this catches the markup hook injecting a <script> that the script hook then re-processes
// (double injection -> duplicate `__flare_node__` -> compile error).
describe('flarePreprocessor — full preprocess() + compile() pipeline', () => {
    test('a scriptless component injects exactly once and compiles', async () => {
        const out = await preprocess('<p>hello</p>', flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        // Must compile: a duplicate `const __flare_node__` throws "already been declared".
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('a component WITH a <script> injects exactly once and compiles', async () => {
        const out = await preprocess('<script>let x = 1;</script>\n<p>{x}</p>', flarePreprocessor(), {
            filename: FAKE_FILE,
        });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('scriptless component honors importSource end-to-end', async () => {
        const out = await preprocess('<p>hello</p>', flarePreprocessor({ importSource: '@flareapp/svelte/inject' }), {
            filename: FAKE_FILE,
        });
        expect(out.code).toContain("from '@flareapp/svelte/inject'");
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
    });
});
