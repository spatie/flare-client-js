<script lang="ts">
    import BuggyButton from './BuggyButton.svelte';

    let { shouldThrow = false }: { shouldThrow?: boolean } = $props();
</script>

<BuggyButton {shouldThrow} />
