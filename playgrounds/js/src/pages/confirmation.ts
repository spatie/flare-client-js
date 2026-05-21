import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';

export const renderConfirmation: RouteHandler = (_match, root) => {
    renderLayout(
        root,
        `<section class="text-center py-16" data-testid="confirmation">
            <h1 class="text-2xl font-semibold mb-2">Order confirmed</h1>
            <p class="text-sm opacity-70 mb-6">A receipt was sent to your inbox.</p>
            <a data-link href="/" class="text-sm text-brand hover:underline">Continue shopping</a>
        </section>`
    );
};
