import { ref, type Ref } from 'vue';

// Shared trigger that drives MaybeThrowing on the Broken page.
// Lives at module scope so the FlareErrorBoundary onReset handler in Layout
// can clear it without coupling to the BrokenPage instance.
export const brokenTrigger: Ref<string | null> = ref(null);

export const clearBrokenTrigger = (): void => {
    brokenTrigger.value = null;
};
