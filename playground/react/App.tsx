import { flare } from '@flareapp/js';
import { FlareErrorBoundary } from '@flareapp/react';
import { useState } from 'react';

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
                <FlareErrorBoundary onError={() => console.log('FlareErrorBoundary onError callback')}>
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
