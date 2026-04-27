import { flare } from '../../shared/initFlare';
import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderRapidFireSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Rapid-fire error reporting',
        description: 'Fires 50 errors in a tight loop. Exposes the absence of client-side rate limiting.',
    });

    body.appendChild(
        createButton({
            text: 'Rapid-fire 50 errors',
            onClick() {
                console.log('Firing 50 errors rapidly (exposes lack of rate limiting)');
                for (let i = 0; i < 50; i++) {
                    flare.report(new Error(`Rapid-fire error #${i + 1}`));
                }
                console.log('All 50 errors submitted', 'ok');
            },
        })
    );
}
