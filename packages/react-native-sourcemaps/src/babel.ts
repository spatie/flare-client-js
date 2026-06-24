import type * as Babel from '@babel/core';

import { resolveVersion } from './version';

const ENV_TOKEN = 'FLARE_SOURCEMAP_VERSION';

// Type queries on dynamic imports: no runtime import of @babel/* is emitted.
// `Types` is the shape of the `t` helper object; `MemberExpressionNode` is the
// AST interface. The types resolve via @types/babel__core (dev dependency).
type Types = typeof import('@babel/types');
type MemberExpressionNode = import('@babel/types').MemberExpression;

/**
 * Babel plugin that replaces `process.env.FLARE_SOURCEMAP_VERSION` with the
 * resolved version string at bundle time. Metro does not inline arbitrary
 * `process.env` reads, so without this the value is `undefined` at runtime in a
 * bare RN app. The version is resolved once per plugin instance (lazily, on the
 * first match) via the shared `resolveVersion()`.
 */
export default function flareSourcemapsBabelPlugin({ types: t }: { types: Types }): Babel.PluginObj {
    let version: string | undefined;

    return {
        name: '@flareapp/react-native-sourcemaps',
        // Reset per-file so the env var is re-read on each transformSync call
        // (needed for test isolation and supports incremental rebuild scenarios).
        pre() {
            version = undefined;
        },
        visitor: {
            MemberExpression(path: Babel.NodePath<MemberExpressionNode>) {
                if (!isFlareVersionAccess(path.node, t)) {
                    return;
                }
                // Resolve lazily: once per babel plugin instance. Babel caches the
                // plugin instance across transformSync calls with the same function
                // reference, so version is resolved on the first matching node only.
                // For real builds this is fine: FLARE_SOURCEMAP_VERSION is stable
                // for the entire Metro bundler run.
                if (version === undefined) {
                    version = resolveVersion();
                }
                path.replaceWith(t.stringLiteral(version));
            },
        },
    };
}

/** Matches `process.env.FLARE_SOURCEMAP_VERSION` and `process.env["FLARE_SOURCEMAP_VERSION"]`. */
function isFlareVersionAccess(node: MemberExpressionNode, t: Types): boolean {
    const object = node.object;
    if (!t.isMemberExpression(object) || object.computed) {
        return false;
    }
    if (!t.isIdentifier(object.object, { name: 'process' })) {
        return false;
    }
    if (!t.isIdentifier(object.property, { name: 'env' })) {
        return false;
    }
    if (node.computed) {
        return t.isStringLiteral(node.property, { value: ENV_TOKEN });
    }
    return t.isIdentifier(node.property, { name: ENV_TOKEN });
}
