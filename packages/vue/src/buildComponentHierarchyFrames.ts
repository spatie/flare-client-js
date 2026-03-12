import type { ComponentPublicInstance } from 'vue';

import { MAX_HIERARCHY_DEPTH } from './constants';
import { getComponentName } from './getComponentName';
import { ComponentHierarchyFrame } from './types';

export function buildComponentHierarchyFrames(instance: ComponentPublicInstance | null): ComponentHierarchyFrame[] {
    const frames: ComponentHierarchyFrame[] = [];
    let current = instance;

    while (current && frames.length < MAX_HIERARCHY_DEPTH) {
        const options = current.$options as { __file?: string };

        frames.push({
            component: getComponentName(current),
            file: options.__file ?? null,
            props: current.$props ? { ...current.$props } : null,
        });

        current = current.$parent;
    }

    return frames;
}
