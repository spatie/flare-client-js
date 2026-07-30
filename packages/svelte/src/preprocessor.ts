import { createComponentMatcher, type ProfileComponentsOption } from '@flareapp/core/util';
import MagicString from 'magic-string';
import type { PreprocessorGroup } from 'svelte/compiler';

import { resolveProfileName } from './resolveProfileName.js';

// Loaded on demand. A static import puts svelte/compiler in the module graph of the runtime entries,
// which re-export this file, and svelte declares no `sideEffects` so nothing shakes it back out.
let compiler: Promise<typeof import('svelte/compiler')> | undefined;

function loadCompiler(): Promise<typeof import('svelte/compiler')> {
    compiler ??= import('svelte/compiler');

    return compiler;
}

export interface FlarePreprocessorOptions {
    exclude?: RegExp;
    importSource?: string;
    /** Inject the component-tree registration used by error reports. */
    componentTracking?: boolean;
    /** Which components get a mount span. Matched against the route-aware profile name. */
    profileComponents?: ProfileComponentsOption;
    /** Project-relative routes directory, from `kit.files.routes`. */
    routesDir?: string;
}

export function flarePreprocessor(options?: FlarePreprocessorOptions): PreprocessorGroup {
    const exclude = options?.exclude;
    const importSource = options?.importSource ?? '@flareapp/svelte';
    const componentTracking = options?.componentTracking ?? true;
    const routesDir = options?.routesDir ?? 'src/routes';
    const matchesProfile = createComponentMatcher(options?.profileComponents ?? false);

    /** What to inject for one file, or null when this file gets nothing. */
    function buildInjection(filename: string): string | null {
        const profileName = resolveProfileName(filename, routesDir);
        const shouldProfile = matchesProfile(profileName);
        if (!componentTracking && !shouldProfile) {
            return null;
        }

        const imports: string[] = [];
        const statements: string[] = [];

        if (componentTracking) {
            imports.push('__flareRegisterComponent as __flare_reg__');
            statements.push(
                `const __flare_node__ = __flare_reg__('${escapeString(extractComponentName(filename))}', '${escapeString(filename)}');`,
            );
        }

        if (shouldProfile) {
            imports.push('__flareProfileComponent as __flare_prof__');
            statements.push(`__flare_prof__('${escapeString(profileName)}');`);
        }

        return `import { ${imports.join(', ')} } from '${importSource}';\n${statements.join('\n')}\n`;
    }

    return {
        name: 'flare-component-tree',

        async markup({ content, filename }) {
            if (!filename?.includes('.svelte') || exclude?.test(filename)) {
                return;
            }

            const injection = buildInjection(filename);
            if (!injection) {
                return;
            }

            const start = await instanceScriptStart(content, filename);
            if (start === undefined) {
                return;
            }

            return injectWithMap(content, injection, filename, start);
        },
    };
}

/** Svelte's own `get_basename`, which is what its sourcemap chaining compares against. */
function basename(filename: string): string {
    return filename.split(/[/\\]/).pop() ?? filename;
}

/**
 * The name error reports use. Stays a bare basename rather than reusing `resolveProfileName`, because
 * changing it would change component hierarchies people already have.
 */
function extractComponentName(filename: string): string {
    return basename(filename).replace(/\.svelte$/, '');
}

function escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Svelte's AST carries this at runtime; its estree `Program` type does not declare it. */
type ScriptBody = { start: number };

/**
 * Where the instance script's body begins, `null` when the component has none, `undefined` when the
 * source cannot be parsed. Svelte hands a script hook every `<script>` in the file, nested ones
 * included, so only the parser can say which one belongs to the component.
 */
async function instanceScriptStart(content: string, filename: string): Promise<number | null | undefined> {
    const { parse } = await loadCompiler();

    try {
        const root = parse(content, { modern: true, filename });

        return root.instance ? (root.instance.content as unknown as ScriptBody).start : null;
    } catch {
        // Not Svelte yet: a markup preprocessor further down the chain may still have to transform it.
        // Skipping costs a registration; guessing corrupts the file.
        return undefined;
    }
}

/** The map matters: inserting lines shifts everything below, throwing off stack frames and breakpoints. */
function injectWithMap(content: string, injection: string, filename: string, start: number | null) {
    const s = new MagicString(content);

    if (start === null) {
        s.prepend(`<script>\n${injection}</script>\n`);
    } else {
        s.appendLeft(start, `\n${injection}`);
    }

    return {
        code: s.toString(),
        // Basename, not the full path: Svelte matches sources with get_basename, and on a miss it
        // silently drops the line offset instead of erroring.
        map: s.generateMap({ hires: true, source: basename(filename) }),
    };
}
