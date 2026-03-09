import { flare } from '@flareapp/js';
import { Component, ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { formatComponentStack } from './format-component-stack';

type Props = PropsWithChildren<{
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}>;

type State = {};

export class FlareErrorBoundary extends Component<Props, State> {
    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        const context = {
            react: {
                componentStack: formatComponentStack(errorInfo.componentStack ?? ''),
            },
        };

        flare.report(error, context, { react: { errorInfo } });

        this.props.onError?.(error, errorInfo);
    }

    render(): ReactNode {
        return this.props.children;
    }
}
