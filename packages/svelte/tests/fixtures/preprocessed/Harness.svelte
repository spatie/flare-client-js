<!-- Stands in for SvelteKit's root: hands the page to the layout as a snippet. Not in the allowlist,
     so it records nothing itself. -->
<script lang="ts">
    import Layout from './+layout.svelte';
    import Page from './product/[id]/+page.svelte';
</script>

<Layout>
    <Page />
</Layout>
