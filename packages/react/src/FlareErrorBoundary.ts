import { flare } from '@flareapp/js';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { formatComponentStack } from './format-component-stack';
import { parseComponentStack } from './parse-component-stack';
import { FlareReactContext } from './types';

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentStack: string[];
    resetErrorBoundary: () => void;
};

export type FlareErrorBoundaryProps = PropsWithChildren<{
    fallback?: ReactNode | ((props: FlareErrorBoundaryFallbackProps) => ReactNode);
    resetKeys?: unknown[];
    beforeEvaluate?: (params: { error: Error; errorInfo: ErrorInfo }) => void;
    afterSubmit?: (params: { error: Error; errorInfo: ErrorInfo }) => void;
    onReset?: (error: Error | null) => void;
}>;

export type FlareErrorBoundaryState = {
    error: Error | null;
    componentStack: string[];
};

export class FlareErrorBoundary extends Component<FlareErrorBoundaryProps, FlareErrorBoundaryState> {
    state: FlareErrorBoundaryState = { error: null, componentStack: [] };

    static getDerivedStateFromError(error: Error): Partial<FlareErrorBoundaryState> {
        return { error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.props.beforeEvaluate?.({
            error,
            errorInfo,
        });

        const rawStack = errorInfo.componentStack ?? '';

        const context: FlareReactContext = {
            react: {
                componentStack: formatComponentStack(rawStack),
                componentStackFrames: parseComponentStack(rawStack),
            },
        };

        this.setState({ componentStack: context.react.componentStack });

        flare.report(error, context, { react: { errorInfo } });

        this.props.afterSubmit?.({
            error,
            errorInfo,
        });
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
        const { error } = this.state;

        this.props.onReset?.(error);

        this.setState({ error: null, componentStack: [] });
    };

    render() {
        const { error } = this.state;

        if (error !== null) {
            const { fallback } = this.props;

            if (typeof fallback === 'function') {
                return fallback({
                    error,
                    componentStack: this.state.componentStack,
                    resetErrorBoundary: this.reset,
                });
            }

            return fallback ?? null;
        }

        return this.props.children;
    }
}
