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

    test('a component with ONLY a module script gets exactly one instance registration (B-svelte-2)', async () => {
        const source = `<script module>\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });

    test('a component with ONLY a legacy context="module" script gets exactly one registration (B-svelte-2)', async () => {
        const source = `<script context="module">\nexport const shared = 1;\n</script>\n<p>hi</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
    });

    test('a component with BOTH module and instance scripts registers exactly once (B-svelte-2)', async () => {
        const source = `<script module>\nexport const shared = 1;\n</script>\n<script>let y = 2;</script>\n<p>{y}</p>`;
        const out = await preprocess(source, flarePreprocessor(), { filename: FAKE_FILE });
        expect((out.code.match(/__flare_node__/g) || []).length).toBe(1);
        expect(() => compile(out.code, { filename: FAKE_FILE })).not.toThrow();
    });
});

// A component filename whose basename contains a single quote or backslash is legal on
// macOS/Linux and must not break the emitted JS by prematurely closing the string literal.
describe('flarePreprocessor — component name escaping (B-svelte-1)', () => {
    const APOSTROPHE_FILE = "/app/src/Product's.svelte";

    test('escapes a single quote in the component name (markup hook)', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).markup({ content: '<p>hi</p>', filename: APOSTROPHE_FILE });
        expect(out.code).toContain("__flare_reg__('Product\\'s'");
        // The unescaped form would close the string literal early and inject stray JS.
        expect(out.code).not.toContain("__flare_reg__('Product's'");
    });

    test('escapes a single quote in the component name (script hook)', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({
            content: 'let x = 1;',
            filename: APOSTROPHE_FILE,
            attributes: SCRIPT_ATTRS,
        });
        expect(out.code).toContain("__flare_reg__('Product\\'s'");
        expect(out.code).not.toContain("__flare_reg__('Product's'");
    });

    test('an apostrophe filename still compiles end-to-end', async () => {
        const out = await preprocess('<p>hi</p>', flarePreprocessor(), { filename: APOSTROPHE_FILE });
        expect(() => compile(out.code, { filename: APOSTROPHE_FILE })).not.toThrow();
    });
});

// Prepending lines without a map offsets every subsequent line in stack traces and the debugger.
describe('flarePreprocessor — sourcemap (B-svelte-3)', () => {
    test('the markup hook returns a sourcemap', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).markup({ content: '<p>hi</p>', filename: FAKE_FILE });
        expect(out.map).toBeTruthy();
        expect(out.map.mappings).toBeTypeOf('string');
        expect(out.map.sources).toContain(FAKE_FILE);
    });

    test('the script hook returns a sourcemap', () => {
        const pp = flarePreprocessor();
        const out = (pp as any).script({ content: 'let x = 1;', filename: FAKE_FILE, attributes: SCRIPT_ATTRS });
        expect(out.map).toBeTruthy();
        expect(out.map.mappings).toBeTypeOf('string');
        expect(out.map.sources).toContain(FAKE_FILE);
    });
});
