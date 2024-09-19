import { flare } from '@flareapp/js';

export function flareVue(app) {
    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error, vm, info) => {
        const componentName = vm && vm.$options && vm.$options.name ? vm.$options.name : 'AnonymousComponent';

        const context = {
            vue: { info, componentName },
        };

        flare.report(error, context, { vue: { vm, info } });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, vm, info);

            return;
        }

        throw error;
    };
}
