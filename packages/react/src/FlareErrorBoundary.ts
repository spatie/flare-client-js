import { flare } from '@flareapp/js';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { formatComponentStack } from './format-component-stack';

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    resetErrorBoundary: () => void;
};

export type FlareErrorBoundaryProps = PropsWithChildren<{
    fallback?: ReactNode | ((props: FlareErrorBoundaryFallbackProps) => ReactNode);
    resetKeys?: unknown[];
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    onReset?: () => void;
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

    componentDidUpdate(prevProps: FlareErrorBoundaryProps) {
        if (this.state.error === null || !this.props.resetKeys) {
            return;
        }

        const prevKeys = prevProps.resetKeys;
        const nextKeys = this.props.resetKeys;

        const lengthChanged = prevKeys?.length !== nextKeys.length;
        const valuesChanged = nextKeys.some((key, i) => !Object.is(key, prevKeys?.[i]));

        if (lengthChanged || valuesChanged) {
            this.reset();
        }
    }

    reset = () => {
        this.setState({ error: null });

        this.props.onReset?.();
    };

    render() {
        const { error } = this.state;

        if (error !== null) {
            const { fallback } = this.props;

            if (typeof fallback === 'function') {
                return fallback({
                    error,
                    resetErrorBoundary: this.reset,
                });
            }

            return fallback ?? null;
        }

        return this.props.children;
    }
}
