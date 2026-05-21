import { getContext, onDestroy, setContext } from 'svelte';

export interface ComponentTreeNode {
    name: string;
    file: string;
    parent: ComponentTreeNode | null;
}

const CONTEXT_KEY = '__flare_component_tree';

const registry = new Map<string, Set<ComponentTreeNode>>();

export function __flareRegisterComponent(name: string, file: string): ComponentTreeNode {
    let parent: ComponentTreeNode | null = null;

    try {
        parent = getContext<ComponentTreeNode>(CONTEXT_KEY) ?? null;
    } catch {
        // getContext throws outside component init
    }

    const node: ComponentTreeNode = { name, file, parent };

    try {
        setContext(CONTEXT_KEY, node);
    } catch {
        // setContext throws outside component init
    }

    let nodes = registry.get(file);
    if (!nodes) {
        nodes = new Set();
        registry.set(file, nodes);
    }
    nodes.add(node);

    try {
        onDestroy(() => {
            const set = registry.get(file);
            if (set) {
                set.delete(node);
                if (set.size === 0) {
                    registry.delete(file);
                }
            }
        });
    } catch {
        // onDestroy throws outside component init
    }

    return node;
}

export function getComponentTreeContext(): ComponentTreeNode | null {
    try {
        return getContext<ComponentTreeNode>(CONTEXT_KEY) ?? null;
    } catch {
        return null;
    }
}

export function lookupComponentTree(fileName: string, ancestor?: ComponentTreeNode | null): string[] {
    const node = findNode(fileName, ancestor);

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

export function findNode(fileName: string, ancestor?: ComponentTreeNode | null): ComponentTreeNode | undefined {
    const normalizedLookup = normalizePath(fileName);
    const candidates: ComponentTreeNode[] = [];

    for (const [registeredFile, nodes] of registry) {
        const normalizedFile = normalizePath(registeredFile);
        const match =
            normalizedLookup === normalizedFile ||
            normalizedLookup.endsWith(normalizedFile) ||
            normalizedFile.endsWith(normalizedLookup);

        if (match) {
            for (const node of nodes) {
                candidates.push(node);
            }
        }
    }

    if (candidates.length === 0) {
        return undefined;
    }

    if (ancestor && candidates.length > 1) {
        return candidates.find((c) => hasAncestor(c, ancestor)) ?? candidates[0];
    }

    return candidates[0];
}

function hasAncestor(node: ComponentTreeNode, ancestor: ComponentTreeNode): boolean {
    let current: ComponentTreeNode | null = node.parent;
    const seen = new Set<ComponentTreeNode>();

    while (current && !seen.has(current)) {
        if (current === ancestor) return true;
        seen.add(current);
        current = current.parent;
    }

    return false;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^.*?\/src\//, 'src/');
}
