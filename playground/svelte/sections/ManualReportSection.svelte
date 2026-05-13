<script lang="ts">
    import { flare } from '../../shared/initFlare';
    import Button from '../components/Button.svelte';
    import TestSection from '../components/TestSection.svelte';
</script>

<TestSection
    title="Manual flare.report()"
    description="Calls flare.report() directly with a synthetic error. No throw, no listener involvement."
>
    <Button
        onclick={() => {
            console.log('Calling flare.report() from Svelte component');
            flare.report(new Error('Manually reported from Svelte'));
        }}
    >
        flare.report() from component
    </Button>
</TestSection>
