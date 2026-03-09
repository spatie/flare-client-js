import { createSidebar } from '../shared/create-sidebar';
import { flare } from '../shared/flare';

import { createButton } from './create-button';

createSidebar();

createButton({
    text: 'Throw error in setTimeout',
    onClick() {
        console.log('Throwing uncaught error in setTimeout');
        setTimeout(() => {
            throw new Error('Uncaught error from setTimeout');
        }, 0);
    },
});

createButton({
    text: 'Unhandled promise rejection',
    onClick() {
        console.log('Creating unhandled promise rejection');
        Promise.reject(new Error('Unhandled promise rejection'));
    },
});

createButton({
    text: 'Non-Error rejection (string)',
    onClick() {
        console.log('Rejecting with a string (exposes silent drop gap)');
        Promise.reject('This is a string, not an Error');
    },
});

createButton({
    text: 'TypeError (null access)',
    onClick() {
        console.log('Triggering TypeError via null property access');
        setTimeout(() => {
            const obj: any = null;
            obj.property;
        }, 0);
    },
});

createButton({
    text: 'Error with cause chain',
    onClick() {
        console.log('Throwing error with cause chain (exposes gap)');
        setTimeout(() => {
            const inner = new Error('Inner cause');
            throw new Error('Outer error with cause', { cause: inner });
        }, 0);
    },
});

createButton({
    text: 'flare.report(error)',
    onClick() {
        console.log('Calling flare.report() manually');
        flare.report(new Error('Manually reported error'));
    },
});

createButton({
    text: 'flare.reportMessage()',
    onClick() {
        console.log('Calling flare.reportMessage()');
        flare.reportMessage('This is a manually reported message');
    },
});

createButton({
    text: 'flare.test()',
    onClick() {
        console.log('Calling flare.test() to verify connection');
        flare.test();
    },
});

createButton({
    text: 'Error with glows',
    onClick() {
        console.log('Adding glows then reporting error');
        flare.glow('User clicked checkout', 'info', { page: '/checkout' });
        flare.glow('Payment form submitted', 'info', { method: 'credit_card' });
        flare.glow('Payment API responded', 'error', { status: 500 });
        flare.report(new Error('Payment processing failed'));
    },
});

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
});

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
});

createButton({
    text: 'beforeSubmit (modify)',
    onClick() {
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
        flare.report(new Error('Error modified by beforeSubmit'));
        flare.configure({ beforeSubmit: original });
    },
});

createButton({
    text: 'Rapid-fire 50 errors',
    onClick() {
        console.log('Firing 50 errors rapidly (exposes lack of rate limiting)');
        for (let i = 0; i < 50; i++) {
            flare.report(new Error(`Rapid-fire error #${i + 1}`));
        }
        console.log('All 50 errors submitted', 'ok');
    },
});
