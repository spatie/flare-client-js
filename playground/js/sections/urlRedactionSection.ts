import { flare } from '../../shared/initFlare';
import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderUrlRedactionSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'URL redaction',
        description:
            'Triggers an error while the URL contains sensitive query parameters. Verifies that token/session values are scrubbed in the report.',
    });

    body.appendChild(
        createButton({
            text: 'Error with sensitive URL params',
            onClick() {
                history.replaceState({}, '', '/js/?token=secret123&session_id=sess_abc&visible=keep');
                flare.report(new Error('URL redaction test error'));
            },
        })
    );
}
