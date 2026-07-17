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
        // Flare-internal decode field, not display context. `react_version` is read from React's own
        // `version` export, NOT context.react.version: reading it off the context would re-couple this
        // field to a value a beforeSubmit hook can strip, which is the failure this design prevents.
        // Do not "simplify" it back onto the context.
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
