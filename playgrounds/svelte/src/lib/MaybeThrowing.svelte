<script lang="ts">
    interface Props {
        trigger: string | null;
    }

    const props: Props = $props();

    if (props.trigger) {
        throw new Error(props.trigger);
    }
</script>
