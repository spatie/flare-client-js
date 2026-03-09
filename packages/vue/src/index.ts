import { flare } from '@flareapp/js';
import type { App, ComponentPublicInstance } from 'vue';

export function flareVue(app: App): void {
    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
        const componentName =
            instance && instance.$options && instance.$options.name ? instance.$options.name : 'AnonymousComponent';

        const context = {
            vue: { info, componentName },
        };

        flare.report(error as Error, context, { vue: { instance, info } });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        throw error;
    };
}
