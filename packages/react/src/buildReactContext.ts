import { version } from 'react';

import { formatComponentStack } from './formatComponentStack';
import { parseComponentStack } from './parseComponentStack';
import type { FlareReactContext } from './types';

export function buildReactContext(rawStack: string): FlareReactContext {
    return {
        react: {
            componentStack: formatComponentStack(rawStack),
            componentStackFrames: parseComponentStack(rawStack),
            version,
        },
    };
}
