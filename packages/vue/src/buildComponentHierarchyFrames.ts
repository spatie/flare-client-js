import type { ComponentPublicInstance } from 'vue';

import { MAX_HIERARCHY_DEPTH } from './constants';
import { getComponentName } from './getComponentName';
import { serializeProps } from './serializeProps';
import { ComponentHierarchyFrame } from './types';

export type BuildComponentHierarchyFramesOptions = {
    attachProps: boolean;
    propsMaxDepth: number;
};

export function buildComponentHierarchyFrames(
    instance: ComponentPublicInstance | null,
    options: BuildComponentHierarchyFramesOptions
): ComponentHierarchyFrame[] {
    const frames: ComponentHierarchyFrame[] = [];
    let current = instance;

    while (current && frames.length < MAX_HIERARCHY_DEPTH) {
        const frameOptions = current.$options as { __file?: string };
        const frame: ComponentHierarchyFrame = {
            component: getComponentName(current),
            file: frameOptions.__file ?? null,
        };

        if (options.attachProps && current.$props) {
            frame.props = serializeProps(current.$props, options.propsMaxDepth);
        }

        frames.push(frame);

        current = current.$parent;
    }

    return frames;
}
