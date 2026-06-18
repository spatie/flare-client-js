import type { Flare } from '@flareapp/js/browser';
import { FlareErrorBoundary as InjectBoundary, type FlareErrorBoundaryProps } from '@flareapp/react/inject';
import { createElement, type ReactElement } from 'react';

import { flare } from './singleton';

/**
 * React Native error boundary. A thin wrapper over `@flareapp/react`'s
 * `/inject` boundary that injects the RN `flare` singleton.
 *
 * `flare` is applied AFTER `{...props}` so a consumer cannot override the
 * singleton. The `as unknown as Flare` cast is required: the boundary prop is
 * typed against `@flareapp/js/browser`'s `Flare` (a superset of
 * `ReactNativeFlare`), so structural assignment does not hold. Safe at runtime —
 * the boundary only calls a core-level method (`reportSilently`), which
 * `ReactNativeFlare` inherits.
 */
export function FlareErrorBoundary(props: Omit<FlareErrorBoundaryProps, 'flare'>): ReactElement {
    return createElement(InjectBoundary, { ...props, flare: flare as unknown as Flare });
}
