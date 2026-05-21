<script lang="ts">
    import Child from './Child.svelte';
    import ParentA from './ParentA.svelte';
    import ParentB from './ParentB.svelte';
</script>

<ParentA>
    <Child />
</ParentA>

<ParentB>
    <Child />
</ParentB>
