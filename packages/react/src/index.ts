import { flare } from '@flareapp/js';
import { Component, PropsWithChildren } from 'react';

interface Context {
    react: {
        componentStack: Array<String>;
    };
}

export class FlareErrorBoundary extends Component<PropsWithChildren> {
    componentDidCatch(error: Error, reactErrorInfo: React.ErrorInfo) {
        const context: Context = {
            react: {
                componentStack: formatReactComponentStack(reactErrorInfo?.componentStack ?? ''),
            },
        };

        flare.report(error, context, { react: { errorInfo: reactErrorInfo } });
    }

    render() {
        return this.props.children;
    }
}

function formatReactComponentStack(stack: string) {
    return stack.split(/\s*\n\s*/g).filter((line) => line.length > 0);
}
