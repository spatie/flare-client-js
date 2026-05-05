import { flare } from '../../shared/initFlare';
import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderManualReportingSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'Manual reporting API',
        description:
            'Reports without relying on a global listener. `flare.report()` sends an Error, `flare.reportMessage()` sends a plain string, `flare.test()` sends a synthetic report to verify the connection.',
        bodyClass: 'flex flex-wrap items-center gap-3',
    });

    body.appendChild(
        createButton({
            text: 'flare.report(error)',
            onClick() {
                console.log('Calling flare.report() manually');
                flare.report(new Error('Manually reported error'));
            },
        })
    );

    body.appendChild(
        createButton({
            text: 'flare.reportMessage()',
            onClick() {
                console.log('Calling flare.reportMessage()');
                flare.reportMessage('This is a manually reported message');
            },
        })
    );

    body.appendChild(
        createButton({
            text: 'flare.test()',
            onClick() {
                console.log('Calling flare.test() to verify connection');
                flare.test();
            },
        })
    );
}
