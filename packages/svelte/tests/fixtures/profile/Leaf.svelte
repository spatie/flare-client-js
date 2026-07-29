<script lang="ts">
    import { __flareProfileComponent } from '../../../src/profileComponent.js';

    let { name }: { name: string } = $props();

    // svelte-ignore state_referenced_locally -- only the mount-time name is ever recorded.
    __flareProfileComponent(name);
</script>

<span>{name}</span>
