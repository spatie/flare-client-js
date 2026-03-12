import type { ComponentPublicInstance } from 'vue';

export function getComponentName(instance: ComponentPublicInstance | null): string {
    if (!instance) {
        return 'AnonymousComponent';
    }

    const options = instance.$options as { __name?: string; name?: string };

    return options.__name || options.name || 'AnonymousComponent';
}
