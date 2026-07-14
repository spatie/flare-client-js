import type { AttributeValue, Attributes } from '@flareapp/core';
import { toCustomContext } from '@flareapp/core';
import { version } from 'react';

import type { FlareReactContext, MinifiedReactError } from './types';

export function contextToAttributes(context: FlareReactContext, minifiedError?: MinifiedReactError | null): Attributes {
    return {
        ...toCustomContext('react', {
            componentStack: context.react.componentStack as AttributeValue,
            componentStackFrames: context.react.componentStackFrames as AttributeValue,
            ...(context.react.version ? { version: context.react.version as AttributeValue } : {}),
        }),
        // Internal protocol field rather than custom context: the backend parses it into a usable
        // error message, and it is not something a user needs to see.
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
