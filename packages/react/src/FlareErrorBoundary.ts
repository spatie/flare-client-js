import type { Flare } from '@flareapp/js/browser';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { buildReactContext } from './buildReactContext';
import { contextToAttributes } from './contextToAttributes';
import { tagReactFramework } from './identify';
import { resolveFlare } from './resolveFlare';
import { FlareReactContext } from './types';

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentStack: string[];
    resetErrorBoundary: () => void;
};

export type FlareErrorBoundaryProps = PropsWithChildren<{
    flare?: Flare;
    fallback?: ReactNode | ((props: FlareErrorBoundaryFallbackProps) => ReactNode);
    resetKeys?: unknown[];
    beforeEvaluate?: (params: { error: Error; errorInfo: ErrorInfo }) => void;
    beforeSubmit?: (params: { error: Error; errorInfo: ErrorInfo; context: FlareReactContext }) => FlareReactContext;
    afterSubmit?: (params: { error: Error; errorInfo: ErrorInfo; context: FlareReactContext }) => void;
    onReset?: (error: Error | null) => void;
}>;

export type FlareErrorBoundaryState = {
    error: Error | null;
    componentStack: string[];
};

export class FlareErrorBoundary extends Component<FlareErrorBoundaryProps, FlareErrorBoundaryState> {
    private readonly flare: Flare;

    constructor(props: FlareErrorBoundaryProps) {
        super(props);
        // Resolve ONCE at construction (boot), not per error. Throws here if no
        // instance and no registered default — a wiring bug fails fast.
        this.flare = resolveFlare(props.flare);
        tagReactFramework(this.flare);
    }

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

        const context = buildReactContext(rawStack, error);

        const finalContext =
            this.props.beforeSubmit?.({
                error,
                errorInfo,
                context,
            }) ?? context;

        this.setState({ componentStack: finalContext.react.componentStack });

        // Swallow rejection from the report call. A network/transport failure in the error reporter
        // must not bubble up and cause a second render error inside the boundary itself.
        this.flare.reportSilently(error, contextToAttributes(finalContext));

        this.props.afterSubmit?.({
            error,
            errorInfo,
            context: finalContext,
        });
    }

    // resetKeys mirrors react-error-boundary's contract: when any element of the array changes by
    // Object.is, the boundary auto-resets. Use this to recover from an error after a route change
    // or a retry button toggling a counter, without the consumer wiring up resetErrorBoundary().
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
