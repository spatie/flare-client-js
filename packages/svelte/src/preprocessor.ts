import { createComponentMatcher, type ProfileComponentsOption } from '@flareapp/core/util';
import MagicString from 'magic-string';
import type { PreprocessorGroup } from 'svelte/compiler';

import { resolveProfileName } from './resolveProfileName.js';

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

        markup({ content, filename }) {
            if (!filename?.includes('.svelte') || exclude?.test(filename)) {
                return;
            }

            // Only bail when an INSTANCE script is present; the script hook registers those.
            // A component whose only script is a module script (`<script module>` or the legacy
            // `<script context="module">`) still needs an instance registration injected here,
            // because the script hook skips module scripts entirely and would otherwise leave the
            // component out of the tree.
            if (hasInstanceScript(content)) {
                return;
            }

            const injection = buildInjection(filename);
            if (!injection) {
                return;
            }

            return prependWithMap(content, `<script>\n${injection}</script>\n`, filename);
        },

        script({ content, filename, attributes }) {
            if (!filename?.includes('.svelte') || exclude?.test(filename)) {
                return;
            }

            if (attributes.context === 'module' || attributes.module != null) {
                return;
            }

            if (!isJavaScriptScript(attributes)) {
                return;
            }

            // For a component with no instance script the markup hook adds a `<script>` with our
            // injection, then Svelte runs this script hook over that injected block in the same pass.
            // Without this guard we inject a second time -> a duplicate `const __flare_node__`
            // ("already been declared") or a duplicate profile span. Checking both tokens matters:
            // a profile-only injection contains no `__flare_node__` to recognize.
            if (content.includes('__flare_node__') || content.includes('__flare_prof__')) {
                return;
            }

            const injection = buildInjection(filename);
            if (!injection) {
                return;
            }

            return prependWithMap(content, injection, filename);
        },
    };
}

/**
 * The component-tree name used by error reports. Deliberately a bare basename and deliberately NOT
 * `resolveProfileName`: this name is already published, and changing it would change existing error
 * report hierarchies. Profiling uses the route-aware name instead.
 */
function extractComponentName(filename: string): string {
    const normalized = filename.replace(/\\/g, '/');
    const base = normalized.split('/').pop() ?? filename;
    return base.replace(/\.svelte$/, '');
}

function escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * The regex Svelte's own preprocessor uses to find script tags, copied verbatim from
 * `svelte/src/compiler/preprocess/index.js`. The leading comment alternative is load-bearing: it
 * consumes `<!-- ... -->` first, so a commented-out or documented `<script>` matches as a comment
 * rather than as a tag. Matching Svelte here is the point, because Svelte decides which tags reach
 * the `script` hook and the markup hook has to predict that exactly.
 */
const REGEX_SCRIPT_OR_COMMENT =
    /<!--[^]*?-->|<script((?:\s+[^=>'"/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"/\s]+)*\s*)(?:\/>|>([\S\s]*?)<\/script>)/g;

/**
 * Types Svelte still treats as an instance script. A tag carrying anything else (`application/ld+json`,
 * `importmap`, `text/template`) holds data rather than component code.
 */
const JAVASCRIPT_SCRIPT_TYPES = new Set([
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'module',
]);

/**
 * Returns true when the component source contains at least one instance `<script>`,
 * i.e. a script that is not `<script module>` / `<script context="module">`.
 */
function hasInstanceScript(content: string): boolean {
    // matchAll clones the regex, so the shared `g` literal keeps no lastIndex between calls.
    for (const match of content.matchAll(REGEX_SCRIPT_OR_COMMENT)) {
        if (match[0].startsWith('<!--')) {
            continue;
        }

        if (!isModuleScriptAttributes(match[1] ?? '')) {
            return true;
        }
    }

    return false;
}

/**
 * Svelte hands the `script` hook every script tag in the file, nested ones included, so a
 * `<script type="application/ld+json">` inside the markup arrives here looking like component code.
 * Prepending an import to one corrupts the data it holds. Skipping on an unrecognized type costs at
 * most a missing registration; injecting into one ships broken output.
 */
function isJavaScriptScript(attributes: Record<string, string | boolean>): boolean {
    const type = attributes.type;
    if (type == null || typeof type === 'boolean') {
        return true;
    }

    return JAVASCRIPT_SCRIPT_TYPES.has(type.trim().toLowerCase());
}

/**
 * Detects a Svelte module script from its raw opening-tag attributes: the Svelte 5
 * `<script module>` boolean attribute or the legacy `<script context="module">`.
 */
function isModuleScriptAttributes(attributes: string): boolean {
    return /\bcontext\s*=\s*["']module["']/i.test(attributes) || /(?:^|\s)module(?=\s|=|$)/i.test(attributes);
}

/**
 * Prepends the injected registration to the component source and returns a result with
 * a sourcemap. Prepending lines shifts every following line, so without a map the stack
 * frames and debugger positions inside the original component would be offset.
 */
function prependWithMap(content: string, injection: string, filename: string) {
    const s = new MagicString(content);
    s.prepend(injection);

    return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: filename }),
    };
}
