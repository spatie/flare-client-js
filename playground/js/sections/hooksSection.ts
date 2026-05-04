import { flare } from '../../shared/initFlare';
import { createButton } from '../components/createButton';
import { createTestSection } from '../components/createTestSection';

export function renderHooksSection(parent: HTMLElement) {
    const body = createTestSection(parent, {
        title: 'beforeEvaluate / beforeSubmit hooks',
        description:
            'Installs a hook before reporting. `beforeEvaluate` can suppress the report entirely; `beforeSubmit` can mutate the payload before send.',
        bodyClass: 'flex flex-wrap items-center gap-3',
    });

    body.appendChild(
        createButton({
            text: 'beforeEvaluate (suppress)',
            onClick() {
                const original = flare.config.beforeEvaluate;
                flare.configure({
                    beforeEvaluate: (error) => {
                        console.log(`beforeEvaluate: suppressing error "${error.message}"`);
                        return null as any;
                    },
                });
                flare.report(new Error('This error should be suppressed'));
                console.log('Error was suppressed by beforeEvaluate');
                flare.configure({ beforeEvaluate: original });
            },
        })
    );

    body.appendChild(
        createButton({
            text: 'beforeSubmit (modify)',
            async onClick() {
                const original = flare.config.beforeSubmit;
                flare.configure({
                    beforeSubmit: (report) => {
                        report.context = {
                            ...report.context,
                            custom_hook: { injected_by: 'beforeSubmit hook', timestamp: Date.now() },
                        };
                        console.log('beforeSubmit: added custom_hook context to report');
                        return report;
                    },
                });
                await flare.report(new Error('Error modified by beforeSubmit'));
                flare.configure({ beforeSubmit: original });
            },
        })
    );
}
