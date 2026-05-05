import type { ComponentPublicInstance } from 'vue';

export function getComponentName(instance: ComponentPublicInstance | null): string {
    if (!instance) {
        return 'AnonymousComponent';
    }

    // `__name` is set by the SFC compiler from the filename (e.g. `Foo.vue` -> `Foo`) and is
    // present even for `<script setup>` components that have no manual `name` option. Prefer it
    // over `name` so we get a useful label for the common SFC case.
    const options = instance.$options as { __name?: string; name?: string };

    return options.__name || options.name || 'AnonymousComponent';
}
