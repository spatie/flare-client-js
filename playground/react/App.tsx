import { FlareErrorBoundary } from '@flareapp/react';
import { useState } from 'react';

import { flare } from '../shared/initFlare';

import { AsyncErrorButton } from './AsyncErrorButton';
import { BuggyComponent } from './BuggyComponent';
import { Button } from './Button';

export function App() {
    const [showBuggy, setShowBuggy] = useState(false);

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
                    afterSubmit={() => console.log('FlareErrorBoundary afterSubmit callback')}
                    onReset={() => console.log('FlareErrorBoundary onReset callback')}
                    beforeEvaluate={() => {
                        flare.addContext('playground', 'test');
                        flare.addContext('showBuggy', showBuggy);
                    }}
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
        </>
    );
}
