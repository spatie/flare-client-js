import type { Flare } from '@flareapp/js/browser';
import { FlareErrorBoundary as InjectBoundary, type FlareErrorBoundaryProps } from '@flareapp/react/inject';
import { createElement, type ReactElement } from 'react';

import { flare } from './singleton';

/**
 * Wraps `@flareapp/react`'s `/inject` boundary with the RN `flare` singleton, applied after `{...props}`
 * so callers can't override it. The `Flare` cast is safe: the boundary only calls `reportSilently`, which
 * RN implements too.
 */
export function FlareErrorBoundary(props: Omit<FlareErrorBoundaryProps, 'flare'>): ReactElement {
    return createElement(InjectBoundary, { ...props, flare: flare as unknown as Flare });
}
