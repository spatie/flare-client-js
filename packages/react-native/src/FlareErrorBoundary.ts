import type { Flare } from '@flareapp/js/browser';
import { FlareErrorBoundary as InjectBoundary, type FlareErrorBoundaryProps } from '@flareapp/react/inject';
import { createElement, type ReactElement } from 'react';

import { flare } from './singleton';

/**
 * React Native error boundary: a thin wrapper over `@flareapp/react`'s `/inject` boundary that injects the
 * RN `flare` singleton. `flare` is applied after `{...props}` so a consumer cannot override it. The
 * `as unknown as Flare` cast is needed because the prop is typed against `@flareapp/js/browser`'s `Flare`
 * (a superset); safe at runtime since the boundary only calls `reportSilently`, which RN inherits.
 */
export function FlareErrorBoundary(props: Omit<FlareErrorBoundaryProps, 'flare'>): ReactElement {
    return createElement(InjectBoundary, { ...props, flare: flare as unknown as Flare });
}
