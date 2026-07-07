import type * as Babel from '@babel/core';

import { resolveVersion } from './version';

const RUNTIME_SOURCE = '@flareapp/react-native-sourcemaps/runtime';
const EXPORT_NAME = 'flareSourcemapVersion';

// Type-only import queries: no runtime import of @babel/* is emitted. Resolve via
// @types/babel__core (dev dependency).
type Types = typeof import('@babel/types');
type ImportDeclarationNode = import('@babel/types').ImportDeclaration;
type ImportSpecifierNode = import('@babel/types').ImportSpecifier;

/**
 * Babel plugin that inlines `flareSourcemapVersion` (imported from `.../runtime`) with the resolved
 * version string at bundle time, then removes the now-dead import so nothing of this package ships at
 * runtime. Version resolved once per file, lazily (only when the import is present).
 */
export default function flareSourcemapsBabelPlugin({ types: t }: { types: Types }): Babel.PluginObj {
    let version: string | undefined;

    return {
        name: '@flareapp/react-native-sourcemaps',
        // Babel caches plugin instances across files, so reset the per-file version before each file
        // (also correct for rebuilds where FLARE_SOURCEMAP_VERSION changes between runs).
        pre() {
            version = undefined;
        },
        visitor: {
            ImportDeclaration(path: Babel.NodePath<ImportDeclarationNode>) {
                if (path.node.source.value !== RUNTIME_SOURCE) {
                    return;
                }

                const remaining = [];
                let inlinedAny = false;

                for (const specifier of path.node.specifiers) {
                    if (!isFlareVersionSpecifier(specifier, t)) {
                        remaining.push(specifier);
                        continue;
                    }

                    const binding = path.scope.getBinding(specifier.local.name);
                    if (!binding) {
                        remaining.push(specifier);
                        continue;
                    }

                    if (version === undefined) {
                        version = resolveVersion();
                    }
                    for (const reference of binding.referencePaths) {
                        reference.replaceWith(t.stringLiteral(version));
                    }
                    inlinedAny = true;
                }

                if (!inlinedAny) {
                    return;
                }

                // Drop the import: whole declaration, or just the inlined specifiers if other names
                // were imported too.
                if (remaining.length === 0) {
                    path.remove();
                } else {
                    path.node.specifiers = remaining;
                }
            },
        },
    };
}

/** Matches `import { flareSourcemapVersion } from '.../runtime'` (named, possibly aliased). */
function isFlareVersionSpecifier(
    specifier: ImportDeclarationNode['specifiers'][number],
    t: Types,
): specifier is ImportSpecifierNode {
    if (!t.isImportSpecifier(specifier)) {
        return false;
    }
    const imported = specifier.imported;
    const importedName = t.isIdentifier(imported) ? imported.name : imported.value;
    return importedName === EXPORT_NAME;
}
