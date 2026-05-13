<script lang="ts">
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Uncaught error in an event handler"
    description="Throws synchronously inside onclick. Not caught by the boundary, handled by the global window.onerror listener."
>
    <Button
        onclick={() => {
            console.log('Throwing error in onclick handler');
            throw new Error('Error in Svelte onclick handler');
        }}
    >
        Throw in onclick
    </Button>
</TestSection>
