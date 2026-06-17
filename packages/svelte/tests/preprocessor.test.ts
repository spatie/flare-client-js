import { describe, expect, test } from 'vitest';

import { withFlareConfig } from '../src/config.js';
import { flarePreprocessor } from '../src/preprocessor.js';

const FAKE_FILE = '/app/src/Button.svelte';
const SCRIPT_ATTRS = { lang: undefined };

// Helper: run the script hook (component with <script>)
function runScriptHook(pp: ReturnType<typeof flarePreprocessor>, filename = FAKE_FILE) {
    const result = (pp as any).script({ content: 'console.log("hi");', filename, attributes: SCRIPT_ATTRS });
    return result;
}

// Helper: run the markup hook (no <script> tag — scriptless component)
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
