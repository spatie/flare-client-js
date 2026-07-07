import type { ComponentPublicInstance } from 'vue';

export function getComponentName(instance: ComponentPublicInstance | null): string {
    if (!instance) {
        return 'AnonymousComponent';
    }

    // `__name` is set by the SFC compiler from the filename (e.g. `Foo.vue` -> `Foo`), present even
    // for `<script setup>` components with no manual `name`. Prefer it over `name` for a useful
    // label in the common SFC case.
    const options = instance.$options as { __name?: string; name?: string };

    return options.__name || options.name || 'AnonymousComponent';
}
