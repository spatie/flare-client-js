import type * as Babel from '@babel/core';

import { resolveVersion } from './version';

// The app imports `flareSourcemapVersion` from this runtime entry; the plugin
// inlines it. A typed import (rather than `process.env.FLARE_SOURCEMAP_VERSION`)
// means no Node types, no ambient declarations, and no "looks like a runtime env
// var but isn't" confusion for app authors.
const RUNTIME_SOURCE = '@flareapp/react-native-sourcemaps/runtime';
const EXPORT_NAME = 'flareSourcemapVersion';

// Type queries on dynamic imports: no runtime import of @babel/* is emitted.
// `Types` is the shape of the `t` helper object; the others are AST interfaces.
// They resolve via @types/babel__core (dev dependency).
type Types = typeof import('@babel/types');
type ImportDeclarationNode = import('@babel/types').ImportDeclaration;
type ImportSpecifierNode = import('@babel/types').ImportSpecifier;

/**
 * Babel plugin that inlines `flareSourcemapVersion` (imported from
 * `@flareapp/react-native-sourcemaps/runtime`) with the resolved version string at
 * bundle time, then removes the now-dead import so nothing of this package ships at
 * runtime. The version is resolved once per file (lazily, only when the import is
 * present) via the shared `resolveVersion()`.
 */
export default function flareSourcemapsBabelPlugin({ types: t }: { types: Types }): Babel.PluginObj {
    let version: string | undefined;

    return {
        name: '@flareapp/react-native-sourcemaps',
        // Babel caches plugin instances across files/transforms, so reset the
        // per-file resolved version before each file (also correct for rebuilds
        // where FLARE_SOURCEMAP_VERSION changes between runs).
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

                // Drop the import: either the whole declaration, or just the
                // specifiers we inlined if the user imported other names too.
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
