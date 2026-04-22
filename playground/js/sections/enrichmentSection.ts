import { flare } from '../../shared/initFlare';
import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderEnrichmentSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Enrichment: glows and custom context',
        description:
            'Attaches breadcrumbs (glows) or custom context to a report before sending. Verifies both are forwarded alongside the error.',
        bodyClass: 'flex flex-wrap items-center gap-3',
    });

    body.appendChild(
        createButton({
            text: 'Error with glows',
            onClick() {
                console.log('Adding glows then reporting error');
                flare.glow('User clicked checkout', 'info', { page: '/checkout' });
                flare.glow('Payment form submitted', 'info', { method: 'credit_card' });
                flare.glow('Payment API responded', 'error', { status: 500 });
                flare.report(new Error('Payment processing failed'));
            },
        })
    );

    body.appendChild(
        createButton({
            text: 'Error with custom context',
            onClick() {
                console.log('Adding custom context then reporting error');
                flare.addContext('user_id', 'usr_12345');
                flare.addContext('plan', 'pro');
                flare.addContextGroup('feature_flags', {
                    new_checkout: true,
                    dark_mode: false,
                });
                flare.report(new Error('Error with custom context attached'));
            },
        })
    );
}
