import { ref, type Ref } from 'vue';

// Shared trigger that drives MaybeThrowing on the Broken page. Lives at module scope so
// Layout's FlareErrorBoundary onReset handler can clear it without coupling to BrokenPage.
export const brokenTrigger: Ref<string | null> = ref(null);

export const clearBrokenTrigger = (): void => {
    brokenTrigger.value = null;
};
