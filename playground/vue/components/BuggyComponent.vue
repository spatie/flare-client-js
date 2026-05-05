<script lang="ts">
export default {
    name: 'BuggyComponent',
};
</script>

<script lang="ts" setup>
const props = defineProps<{
    message?: string;
}>();

throw new Error(props.message ?? 'BuggyComponent render error in Vue');
</script>

<template>
    <div>This should never render.</div>
</template>
