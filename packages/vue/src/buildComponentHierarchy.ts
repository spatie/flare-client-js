import type { ComponentPublicInstance } from 'vue';

import { MAX_HIERARCHY_DEPTH } from './constants';
import { getComponentName } from './getComponentName';

export function buildComponentHierarchy(instance: ComponentPublicInstance | null): string[] {
    const hierarchy: string[] = [];
    let current = instance;

    while (current && hierarchy.length < MAX_HIERARCHY_DEPTH) {
        hierarchy.push(getComponentName(current));
        current = current.$parent;
    }

    return hierarchy;
}
