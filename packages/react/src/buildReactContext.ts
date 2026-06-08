import { version } from 'react';

import { formatComponentStack } from './formatComponentStack';
import { parseComponentStack } from './parseComponentStack';
import { parseMinifiedReactError } from './parseMinifiedReactError';
import type { FlareReactContext } from './types';

export function buildReactContext(rawStack: string, error: Error): FlareReactContext {
    const minifiedError = parseMinifiedReactError(error);

    return {
        react: {
            componentStack: formatComponentStack(rawStack),
            componentStackFrames: parseComponentStack(rawStack),
            version,
            ...(minifiedError ? { minifiedError } : {}),
        },
    };
}
