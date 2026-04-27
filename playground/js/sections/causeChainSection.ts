import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderCauseChainSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Error with cause chain',
        description:
            'Throws an Error whose `cause` points at an inner Error. Verifies whether the cause chain is included in the report.',
    });

    body.appendChild(
        createButton({
            text: 'Error with cause chain',
            onClick() {
                console.log('Throwing error with cause chain (exposes gap)');
                setTimeout(() => {
                    const inner = new Error('Inner cause');
                    throw new Error('Outer error with cause', { cause: inner });
                }, 0);
            },
        })
    );
}
