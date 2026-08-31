import type { ComponentPublicInstance } from 'vue';

export function getComponentName(instance: ComponentPublicInstance | null): string {
    if (!instance) {
        return 'AnonymousComponent';
    }

    // `__name` is set by the SFC compiler from the filename (e.g. `Foo.vue` -> `Foo`), even for
    // `<script setup>` components with no manual `name`. Prefer it for the common SFC case.
    const options = instance.$options as { __name?: string; name?: string };

    return options.__name || options.name || 'AnonymousComponent';
}
