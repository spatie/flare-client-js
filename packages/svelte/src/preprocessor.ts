import { createComponentMatcher, withoutStatefulFlags, type ProfileComponentsOption } from '@flareapp/core/util';
import MagicString from 'magic-string';
import type { PreprocessorGroup } from 'svelte/compiler';

import { resolveProfileName } from './resolveProfileName.js';

// Loaded on demand. Our package.json already marks this file shakeable via `sideEffects`, so a static
// import costs nothing in a well-behaved bundler, but this way one that ignores `sideEffects` still
// cannot drag the compiler into an app bundle.
let compiler: Promise<typeof import('svelte/compiler')> | undefined;

function loadCompiler(): Promise<typeof import('svelte/compiler')> {
    compiler ??= import('svelte/compiler').catch((error: unknown) => {
        // Otherwise one transient failure sticks to every remaining file in the build.
        compiler = undefined;

        throw error;
    });

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
    const exclude = withoutStatefulFlags(options?.exclude);
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

/** Copied from Svelte's own preprocessor, so we agree with it on what counts as a style tag. */
const REGEX_STYLE_TAGS =
    /<!--[^]*?-->|<style((?:\s+[^=>'"/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"/\s]+)*\s*)(?:\/>|>([\S\s]*?)<\/style>)/g;

const CLOSING_STYLE_TAG = '</style>';

/** One warning per file per process. A dev server runs this hook again on every save. */
const warnedFiles = new Set<string>();

/**
 * Blanks out every `<style>` body, keeping the exact character count so offsets into the original
 * still line up. Svelte parses style bodies as CSS, so `lang="scss"` and friends throw and would
 * otherwise cost the file its registration.
 */
function blankStyleBodies(content: string): string {
    return content.replace(REGEX_STYLE_TAGS, (match: string, _attributes: string, body?: string) => {
        // The first branch of the regex matches comments, which have no body to blank.
        if (body === undefined || match.startsWith('<!--')) {
            return match;
        }

        const bodyStart = match.length - body.length - CLOSING_STYLE_TAG.length;

        // Newlines survive so reported line numbers keep matching the real file.
        return match.slice(0, bodyStart) + body.replace(/[^\n]/g, ' ') + match.slice(bodyStart + body.length);
    });
}

function warnOnce(filename: string, reason: string): void {
    if (warnedFiles.has(filename)) {
        return;
    }

    warnedFiles.add(filename);
    // Silence here reads as "component tracking works", which is worse than a noisy build.
    console.warn(`[flare] Skipped component tracking for ${filename}: ${reason}`);
}

/**
 * Where the instance script's body begins, `null` when the component has none, `undefined` when the
 * source cannot be parsed. Svelte hands a script hook every `<script>` in the file, nested ones
 * included, so only the parser can say which one belongs to the component.
 */
async function instanceScriptStart(content: string, filename: string): Promise<number | null | undefined> {
    // parse() strips a BOM and we don't, so every offset it hands back would be one character off.
    if (content.charCodeAt(0) === 0xfeff) {
        warnOnce(filename, 'the file starts with a byte order mark');

        return undefined;
    }

    try {
        const { parse } = await loadCompiler();
        const root = parse(blankStyleBodies(content), { modern: true, filename });

        return root.instance ? (root.instance.content as unknown as ScriptBody).start : null;
    } catch (error) {
        // Half-written source, or a template another preprocessor still has to turn into Svelte.
        // Skipping costs a registration; guessing corrupts the file.
        warnOnce(filename, error instanceof Error ? error.message : String(error));

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
        // Basename, not the full path: Svelte merges this map with the compiler's own by matching
        // sources through get_basename, and that merge assumes preprocessor maps name it that way.
        map: s.generateMap({ hires: true, source: basename(filename) }),
    };
}
