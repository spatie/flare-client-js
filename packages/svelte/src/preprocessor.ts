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

            // Only bail on an instance script, since the script hook handles those. A component with
            // just a module script still needs one added here, because the script hook skips those.
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

            // Svelte runs this hook over the block the markup hook just added, so without this we'd
            // inject twice. Both tokens matter: a profile-only injection has no `__flare_node__`.
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
 * The name error reports use. Stays a bare basename rather than reusing `resolveProfileName`, because
 * changing it would change component hierarchies people already have.
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
 * Copied from Svelte's own preprocessor, because Svelte decides which tags reach the script hook and
 * we have to agree with it. The `<!-- -->` branch is what stops a commented-out `<script>` counting.
 */
const REGEX_SCRIPT_OR_COMMENT =
    /<!--[^]*?-->|<script((?:\s+[^=>'"/\s]+=(?:"[^"]*"|'[^']*'|[^>\s]+)|\s+[^=>'"/\s]+)*\s*)(?:\/>|>([\S\s]*?)<\/script>)/g;

/** Anything else (`application/ld+json`, `importmap`, ...) holds data, not component code. */
const JAVASCRIPT_SCRIPT_TYPES = new Set([
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'module',
]);

/** True when the source has a script that isn't `<script module>` / `<script context="module">`. */
function hasInstanceScript(content: string): boolean {
    // matchAll clones the regex, so the shared /g/ literal can't leak lastIndex between calls.
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
 * Svelte passes us every script tag, nested ones too, so a JSON-LD block turns up here looking like
 * component code. Injecting into one would corrupt it, so when in doubt we skip: a missing
 * registration is cheaper than broken output.
 */
function isJavaScriptScript(attributes: Record<string, string | boolean>): boolean {
    const type = attributes.type;
    if (type == null || typeof type === 'boolean') {
        return true;
    }

    return JAVASCRIPT_SCRIPT_TYPES.has(type.trim().toLowerCase());
}

/** Handles both the Svelte 5 `<script module>` and the legacy `<script context="module">`. */
function isModuleScriptAttributes(attributes: string): boolean {
    return /\bcontext\s*=\s*["']module["']/i.test(attributes) || /(?:^|\s)module(?=\s|=|$)/i.test(attributes);
}

/** The map matters: prepending shifts every line below, throwing off stack frames and breakpoints. */
function prependWithMap(content: string, injection: string, filename: string) {
    const s = new MagicString(content);
    s.prepend(injection);

    return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: filename }),
    };
}
