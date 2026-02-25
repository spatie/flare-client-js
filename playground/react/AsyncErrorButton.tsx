import { useEffect, useState } from 'react';

import { Button } from './Button';

export function AsyncErrorButton() {
    const [trigger, setTrigger] = useState(false);

    useEffect(() => {
        if (trigger) {
            setTrigger(false);
            console.log('Triggering async error in useEffect');
            Promise.reject(new Error('Async error in React useEffect'));
        }
    }, [trigger]);

    return (
        <Button
            onClick={() => {
                setTrigger(true);
            }}
        >
            Async error in useEffect
        </Button>
    );
}
