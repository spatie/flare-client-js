import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { rootRoute } from './__root';

// Triggers a genuine React hooks-order invariant during render. In a production
// react-dom build this surfaces as "Minified React error #310; visit
// https://react.dev/errors/310 ..." rather than the dev-mode full message, which
// is exactly what the prod-build e2e spec needs to exercise the decode path.
// The error bubbles to the outer FlareErrorBoundary (see main.tsx).
const HookOrderBomb = ({ armed }: { armed: boolean }) => {
    useState(0);

    if (armed) {
        // This second hook only runs after arming, so the hook count grows between
        // renders: "Rendered more hooks than during the previous render."
        useState(1);
    }

    return null;
};

const ReactInvariantPage = () => {
    const [armed, setArmed] = useState(false);

    return (
        <section>
            <h1 className="text-xl font-semibold mb-2">React invariant</h1>
            <p className="text-sm opacity-70 mb-6">
                Triggers a real React hooks-order error (minified in production builds).
            </p>
            <button
                type="button"
                data-testid="trigger-react-invariant-hooks"
                onClick={() => setArmed(true)}
                className="rounded-lg border border-surface-border bg-surface px-4 py-3 text-sm hover:border-brand"
            >
                Trigger hooks-order invariant
            </button>
            <HookOrderBomb armed={armed} />
        </section>
    );
};

export const reactInvariantRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/react-invariant',
    component: ReactInvariantPage,
});
