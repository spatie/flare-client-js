import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareReactContext } from './types';

export function contextToAttributes(context: FlareReactContext): Attributes {
    return {
        'react.component_stack': context.react.componentStack as AttributeValue,
        'react.component_stack_frames': context.react.componentStackFrames as AttributeValue,
    };
}
