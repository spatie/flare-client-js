<script lang="ts">
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Async error"
    description="Triggers an unhandled promise rejection. Captured via window.onunhandledrejection."
>
    <Button
        onclick={() => {
            console.log('Triggering async error');
            Promise.reject(new Error('Async error in Svelte component'));
        }}
    >
        Async error (unhandled rejection)
    </Button>
</TestSection>
