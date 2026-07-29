<!--
    Stands in for SvelteKit's generated root: it passes the page to the layout as a snippet, which is
    the shape the whole nesting design depends on. Its own name matches no allowlist entry, so it
    records no span and the layout parents straight to the active root.
-->
<script lang="ts">
    import Layout from './+layout.svelte';
    import Page from './product/[id]/+page.svelte';
</script>

<Layout>
    <Page />
</Layout>
