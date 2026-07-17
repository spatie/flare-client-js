import type { AttributeValue, Attributes } from '@flareapp/core';
import { version } from 'react';

import type { FlareReactContext, MinifiedReactError } from './types';

export function contextToAttributes(context: FlareReactContext, minifiedError?: MinifiedReactError | null): Attributes {
    return {
        'context.custom': {
            react: {
                componentStack: context.react.componentStack as AttributeValue,
                componentStackFrames: context.react.componentStackFrames as AttributeValue,
                ...(context.react.version ? { version: context.react.version as AttributeValue } : {}),
            },
        },
        // We do not add to the custom context, but to the flare exception meta data because this is internal data and not something a user needs to see.
        // The flare backend will parse this into a usable error message.
        ...(minifiedError
            ? {
                  'flare.exception.react_minified_error': {
                      number: minifiedError.number,
                      args: minifiedError.args,
                      url: minifiedError.url,
                      react_version: version,
                  } as AttributeValue,
              }
            : {}),
    };
}
