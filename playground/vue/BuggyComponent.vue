<script lang="ts">
export default {
    name: 'BuggyComponent',
};
</script>

<script lang="ts" setup>
throw new Error('BuggyComponent render error in Vue');
</script>

<template>
    <div>This should never render.</div>
</template>
