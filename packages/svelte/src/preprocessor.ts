import MagicString from 'magic-string';
import type { PreprocessorGroup } from 'svelte/compiler';

export interface FlarePreprocessorOptions {
    exclude?: RegExp;
    importSource?: string;
}

export function flarePreprocessor(options?: FlarePreprocessorOptions): PreprocessorGroup {
    const exclude = options?.exclude;
    const importSource = options?.importSource ?? '@flareapp/svelte';

    return {
        name: 'flare-component-tree',

        markup({ content, filename }) {
            if (!filename?.includes('.svelte')) {
                return;
            }

            if (exclude?.test(filename)) {
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

            const componentName = escapeString(extractComponentName(filename));
            const escapedFile = escapeString(filename);

            const injection =
                `<script>\n` +
                `import { __flareRegisterComponent as __flare_reg__ } from '${importSource}';\n` +
                `const __flare_node__ = __flare_reg__('${componentName}', '${escapedFile}');\n` +
                `</script>\n`;

            return prependWithMap(content, injection, filename);
        },

        script({ content, filename, attributes }) {
            if (!filename?.includes('.svelte')) {
                return;
            }

            if (exclude?.test(filename)) {
                return;
            }

            if (attributes.context === 'module' || attributes.module != null) {
                return;
            }

            // For a component with no instance script the markup hook adds a `<script>` with our
            // registration, then Svelte runs this script hook over that injected block in the same
            // pass. Without this guard we inject a second `const __flare_node__` -> "already been
            // declared" error. This also keeps the module-only path (markup injects, script skips)
            // to exactly one registration.
            if (content.includes('__flare_node__')) {
                return;
            }

            const componentName = escapeString(extractComponentName(filename));
            const escapedFile = escapeString(filename);

            const injection =
                `import { __flareRegisterComponent as __flare_reg__ } from '${importSource}';\n` +
                `const __flare_node__ = __flare_reg__('${componentName}', '${escapedFile}');\n`;

            return prependWithMap(content, injection, filename);
        },
    };
}

function extractComponentName(filename: string): string {
    const normalized = filename.replace(/\\/g, '/');
    const base = normalized.split('/').pop() ?? filename;
    return base.replace(/\.svelte$/, '');
}

function escapeString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Returns true when the component source contains at least one instance `<script>`,
 * i.e. a script that is not `<script module>` / `<script context="module">`.
 */
function hasInstanceScript(content: string): boolean {
    for (const match of content.matchAll(/<script(\s[^>]*)?>/gi)) {
        if (!isModuleScriptAttributes(match[1] ?? '')) {
            return true;
        }
    }

    return false;
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
