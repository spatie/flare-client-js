import { getContext, onDestroy, setContext } from 'svelte';

export interface ComponentTreeNode {
    name: string;
    file: string;
    parent: ComponentTreeNode | null;
}

const CONTEXT_KEY = '__flare_component_tree';

const registry = new Map<string, ComponentTreeNode>();

export function __flareRegisterComponent(name: string, file: string): void {
    let parent: ComponentTreeNode | null = null;

    try {
        parent = getContext<ComponentTreeNode>(CONTEXT_KEY) ?? null;
    } catch {
        // getContext throws outside component init — top-level or non-component call
    }

    const node: ComponentTreeNode = { name, file, parent };

    try {
        setContext(CONTEXT_KEY, node);
    } catch {
        // setContext throws outside component init
    }

    registry.set(file, node);

    try {
        onDestroy(() => {
            if (registry.get(file) === node) {
                registry.delete(file);
            }
        });
    } catch {
        // onDestroy throws outside component init
    }
}

export function lookupComponentTree(fileName: string): string[] {
    const normalizedLookup = normalizePath(fileName);

    let node: ComponentTreeNode | undefined;

    for (const [registeredFile, registeredNode] of registry) {
        if (normalizedLookup === normalizePath(registeredFile)) {
            node = registeredNode;
            break;
        }

        if (
            normalizedLookup.endsWith(normalizePath(registeredFile)) ||
            normalizePath(registeredFile).endsWith(normalizedLookup)
        ) {
            node = registeredNode;
            break;
        }
    }

    if (!node) {
        return [];
    }

    const hierarchy: string[] = [];
    let current: ComponentTreeNode | null = node;
    const seen = new Set<ComponentTreeNode>();

    while (current && !seen.has(current)) {
        seen.add(current);
        hierarchy.push(current.name);
        current = current.parent;
    }

    return hierarchy;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/');
}
