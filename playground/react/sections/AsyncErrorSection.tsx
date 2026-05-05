import { useEffect, useState } from 'react';

import { Button } from '../components/Button';
import { TestSection } from '../components/TestSection';

export function AsyncErrorSection() {
    const [trigger, setTrigger] = useState(false);

    useEffect(() => {
        if (trigger) {
            setTrigger(false);
            console.log('Triggering async error in useEffect');
            Promise.reject(new Error('Async error in React useEffect'));
        }
    }, [trigger]);

    return (
        <TestSection
            title="Async error in useEffect"
            description="Triggers an unhandled promise rejection from inside useEffect. Captured via window.onunhandledrejection."
        >
            <Button onClick={() => setTrigger(true)}>Async error in useEffect</Button>
        </TestSection>
    );
}
