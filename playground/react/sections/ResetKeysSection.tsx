import { FlareErrorBoundary } from '@flareapp/react';
import { useState } from 'react';

import { ConditionallyBuggyComponent } from '../ConditionallyBuggyComponent';
import { Button } from '../components/Button';
import { TestSection } from '../components/TestSection';

export function ResetKeysSection() {
    const [shouldThrow, setShouldThrow] = useState(false);
    const [resetCounter, setResetCounter] = useState(0);

    return (
        <TestSection
            title="resetKeys auto-reset"
            description="Triggers an error, then increments a resetKey to auto-reset the boundary. The onReset callback fires, and the child re-renders without error."
        >
            <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => setShouldThrow(true)}>Trigger error</Button>
                <Button
                    onClick={() => {
                        setShouldThrow(false);
                        setResetCounter((c) => c + 1);
                        console.log('Incremented resetKey to', resetCounter + 1);
                    }}
                >
                    Increment resetKey (auto-reset)
                </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
                resetCounter: {resetCounter} | shouldThrow: {String(shouldThrow)}
            </p>
            <div className="mt-3">
                <FlareErrorBoundary
                    resetKeys={[resetCounter]}
                    onReset={(error) =>
                        console.log('FlareErrorBoundary onReset via resetKeys, error was:', error?.message)
                    }
                    fallback={({ error }) => (
                        <p className="text-sm text-red-700">
                            Boundary caught: {error.message} — increment resetKey to recover.
                        </p>
                    )}
                >
                    <ConditionallyBuggyComponent shouldThrow={shouldThrow} />
                </FlareErrorBoundary>
            </div>
        </TestSection>
    );
}
