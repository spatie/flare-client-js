import { FlareErrorBoundary } from '@flareapp/react';
import { useState } from 'react';

import { flare } from '../shared/initFlare';

import { AsyncErrorButton } from './AsyncErrorButton';
import { BuggyComponent } from './BuggyComponent';
import { Button } from './Button';
import { ConditionallyBuggyComponent } from './ConditionallyBuggyComponent';

export function App() {
    const [showBuggy, setShowBuggy] = useState(false);
    const [showStaticFallback, setShowStaticFallback] = useState(false);
    const [showResetKeysDemo, setShowResetKeysDemo] = useState(false);
    const [shouldThrow, setShouldThrow] = useState(true);
    const [resetCount, setResetCount] = useState(0);

    return (
        <>
            <Button
                onClick={() => {
                    console.log('Triggering render error via BuggyComponent');
                    setShowBuggy(true);
                }}
            >
                Trigger render error
            </Button>
            <Button
                onClick={() => {
                    setShowBuggy(false);
                    console.log('Reset BuggyComponent state');
                }}
            >
                Reset render error
            </Button>
            {showBuggy && (
                <FlareErrorBoundary
                    resetKeys={[]}
                    beforeEvaluate={() => {
                        flare.addContext('playground', 'test');
                        flare.addContext('showBuggy', showBuggy);
                    }}
                    beforeSubmit={({ error, context }) => {
                        console.log('FlareErrorBoundary beforeSubmit callback', error.message);
                        context.react.componentStack = [...context.react.componentStack, 'injected by beforeSubmit'];
                        return context;
                    }}
                    afterSubmit={() => console.log('FlareErrorBoundary afterSubmit callback')}
                    onReset={() => console.log('FlareErrorBoundary onReset callback')}
                    fallback={({ error, resetErrorBoundary }) => (
                        <div className="space-y-1">
                            <p>Something went wrong: {error.message}</p>
                            <button
                                className="bg-black text-white rounded-md text-sm font-medium px-2 py-1"
                                onClick={resetErrorBoundary}
                            >
                                Try again
                            </button>
                        </div>
                    )}
                >
                    <BuggyComponent />
                </FlareErrorBoundary>
            )}
            <Button
                onClick={() => {
                    console.log('Throwing error in onClick handler');
                    throw new Error('Error in React onClick handler');
                }}
            >
                Throw in onClick
            </Button>
            <AsyncErrorButton />
            <Button
                onClick={() => {
                    console.log('Calling flare.report() from React component');
                    flare.report(new Error('Manually reported from React'));
                }}
            >
                flare.report() from component
            </Button>
            <Button
                onClick={() => {
                    console.log('Throwing a string (non-Error) in onClick handler');
                    throw 'This is a string throw, not an Error object';
                }}
            >
                Throw string in onClick
            </Button>
            <Button
                onClick={() => {
                    console.log('Triggering static fallback boundary');
                    setShowStaticFallback(true);
                }}
            >
                Trigger static fallback
            </Button>
            <Button
                onClick={() => {
                    setShowStaticFallback(false);
                    console.log('Reset static fallback state');
                }}
            >
                Reset static fallback
            </Button>
            {showStaticFallback && (
                <FlareErrorBoundary
                    fallback={
                        <p className="text-sm text-red-600">
                            Static fallback: something went wrong (no reset available).
                        </p>
                    }
                    afterSubmit={({ error }) => console.log('Static fallback boundary afterSubmit', error.message)}
                >
                    <BuggyComponent />
                </FlareErrorBoundary>
            )}
            <Button
                onClick={() => {
                    console.log('Triggering resetKeys demo');
                    setShouldThrow(true);
                    setShowResetKeysDemo(true);
                }}
            >
                Trigger resetKeys demo
            </Button>
            <Button
                onClick={() => {
                    console.log('Fixing component and changing resetKeys to auto-reset boundary');
                    setShouldThrow(false);
                    setResetCount((c) => c + 1);
                }}
            >
                Fix and reset via resetKeys
            </Button>
            <Button
                onClick={() => {
                    setShowResetKeysDemo(false);
                    setShouldThrow(true);
                    setResetCount(0);
                    console.log('Reset resetKeys demo state');
                }}
            >
                Reset resetKeys demo
            </Button>
            {showResetKeysDemo && (
                <FlareErrorBoundary
                    resetKeys={[resetCount]}
                    onReset={(error) => console.log('resetKeys boundary onReset', error?.message ?? 'no error')}
                    afterSubmit={({ error }) => console.log('resetKeys boundary afterSubmit', error.message)}
                    fallback={({ error }) => (
                        <p className="text-sm text-red-600">
                            resetKeys boundary caught: {error.message} (click "Fix and reset via resetKeys" to recover)
                        </p>
                    )}
                >
                    <ConditionallyBuggyComponent shouldThrow={shouldThrow} />
                </FlareErrorBoundary>
            )}
        </>
    );
}
