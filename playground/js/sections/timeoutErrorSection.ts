import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderTimeoutErrorSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Uncaught error in setTimeout callback',
        description: 'Throws inside a setTimeout callback. Captured by the global window.onerror listener.',
    });

    body.appendChild(
        createButton({
            text: 'Throw error in setTimeout',
            onClick() {
                console.log('Throwing uncaught error in setTimeout');
                setTimeout(() => {
                    throw new Error('Uncaught error from setTimeout');
                }, 0);
            },
        })
    );
}
