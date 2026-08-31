import type { Flare } from '@flareapp/js/browser';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { buildReactContext } from './buildReactContext';
import { contextToAttributes } from './contextToAttributes';
import { tagReactFramework } from './identify';
import { parseMinifiedReactError } from './parseMinifiedReactError';
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
        // Resolved once at construction (throws if no instance/default is registered) and cached for the
        // boundary's lifetime — changing the `flare` prop later on a mounted boundary has no effect.
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

        const context = buildReactContext(rawStack);

        const finalContext =
            this.props.beforeSubmit?.({
                error,
                errorInfo,
                context,
            }) ?? context;

        this.setState({ componentStack: finalContext.react.componentStack });

        // Parsed after beforeSubmit so a hook can't alter this internal protocol field. reportSilently
        // swallows the rejection so a transport failure can't trigger a second render error.
        this.flare.reportSilently(error, contextToAttributes(finalContext, parseMinifiedReactError(error)));

        this.props.afterSubmit?.({
            error,
            errorInfo,
            context: finalContext,
        });
    }

    // resetKeys mirrors react-error-boundary: when any element changes by Object.is, the boundary
    // auto-resets, recovering after a route change or retry without calling resetErrorBoundary().
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
