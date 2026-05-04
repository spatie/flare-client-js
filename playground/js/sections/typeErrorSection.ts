import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderTypeErrorSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'TypeError from null property access',
        description:
            'Accesses a property on null inside a setTimeout callback. Exercises TypeError-specific stack trace parsing.',
    });

    body.appendChild(
        createButton({
            text: 'TypeError (null access)',
            onClick() {
                console.log('Triggering TypeError via null property access');
                setTimeout(() => {
                    const obj: any = null;
                    obj.property;
                }, 0);
            },
        })
    );
}
