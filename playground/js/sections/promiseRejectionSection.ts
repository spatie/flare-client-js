import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderPromiseRejectionSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Unhandled promise rejection',
        description:
            'Rejects a promise without any .catch handler. Captured by window.onunhandledrejection. The string variant covers the case where the rejection value is not an Error instance.',
        bodyClass: 'flex flex-wrap items-center gap-3',
    });

    body.appendChild(
        createButton({
            text: 'Reject with Error',
            onClick() {
                console.log('Creating unhandled promise rejection');
                Promise.reject(new Error('Unhandled promise rejection'));
            },
        })
    );

    body.appendChild(
        createButton({
            text: 'Reject with string',
            onClick() {
                console.log('Rejecting with a string (exposes silent drop gap)');
                Promise.reject('This is a string, not an Error');
            },
        })
    );
}
