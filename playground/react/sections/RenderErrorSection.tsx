import { FlareErrorBoundary } from '@flareapp/react';
import { useState } from 'react';

import { flare } from '../../shared/initFlare';
import { BuggyComponent } from '../components/BuggyComponent';
import { Button } from '../components/Button';
import { TestSection } from '../components/TestSection';

export function RenderErrorSection() {
    const [showBuggy, setShowBuggy] = useState(false);

    return (
        <TestSection
            title="Render error caught by FlareErrorBoundary"
            description="Throws during render inside a <FlareErrorBoundary>. Fallback renders, afterSubmit fires, and resetting unmounts the component so it can be retried."
        >
            <div className="flex flex-wrap items-center gap-3">
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
            </div>
            {showBuggy && (
                <div className="mt-3">
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
                                    className="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                                    onClick={resetErrorBoundary}
                                >
                                    Try again
                                </button>
                            </div>
                        )}
                    >
                        <BuggyComponent />
                    </FlareErrorBoundary>
                </div>
            )}
        </TestSection>
    );
}
