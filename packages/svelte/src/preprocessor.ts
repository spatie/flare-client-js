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

            const hasScript = /<script[\s>]/i.test(content);

            if (hasScript) {
                return;
            }

            const componentName = extractComponentName(filename);
            const escapedFile = escapeString(filename);

            const injection =
                `<script>\n` +
                `import { __flareRegisterComponent as __flare_reg__ } from '${importSource}';\n` +
                `const __flare_node__ = __flare_reg__('${componentName}', '${escapedFile}');\n` +
                `</script>\n`;

            return {
                code: injection + content,
            };
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

            const componentName = extractComponentName(filename);
            const escapedFile = escapeString(filename);

            const injection =
                `import { __flareRegisterComponent as __flare_reg__ } from '${importSource}';\n` +
                `const __flare_node__ = __flare_reg__('${componentName}', '${escapedFile}');\n`;

            return {
                code: injection + content,
            };
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
