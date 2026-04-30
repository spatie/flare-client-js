import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareReactContext } from './types';

export function contextToAttributes(context: FlareReactContext): Attributes {
    return {
        'context.custom': {
            framework: 'react',
            react: {
                componentStack: context.react.componentStack as AttributeValue,
                componentStackFrames: context.react.componentStackFrames as AttributeValue,
            },
        },
    };
}
