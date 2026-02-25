import { flare } from '@flareapp/js';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { formatComponentStack } from './format-component-stack';

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
};

export type FlareErrorBoundaryProps = PropsWithChildren<{
    fallback?: ReactNode | ((props: FlareErrorBoundaryFallbackProps) => ReactNode);
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}>;

export type FlareErrorBoundaryState = {
    error: Error | null;
};

export class FlareErrorBoundary extends Component<FlareErrorBoundaryProps, FlareErrorBoundaryState> {
    state: FlareErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): FlareErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        const context = {
            react: {
                componentStack: formatComponentStack(errorInfo.componentStack ?? ''),
            },
        };

        flare.report(error, context, { react: { errorInfo } });

        this.props.onError?.(error, errorInfo);
    }

    render() {
        const { error } = this.state;

        if (error !== null) {
            const { fallback } = this.props;

            if (typeof fallback === 'function') {
                return fallback({
                    error,
                });
            }

            return fallback ?? null;
        }

        return this.props.children;
    }
}
