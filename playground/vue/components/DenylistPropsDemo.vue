<script lang="ts">
export default {
    name: 'DenylistPropsDemo',
};
</script>

<script lang="ts" setup>
defineProps<{
    username: string;
    password: string;
    authToken: string;
    apiKey: string;
    sessionId: string;
    config: {
        theme: string;
        pin: string;
        cvv: string;
        regular: string;
    };
}>();

throw new Error('DenylistPropsDemo threw (default prop denylist should redact sensitive fields)');
</script>

<template>
    <div></div>
</template>
