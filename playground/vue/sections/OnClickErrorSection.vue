<script lang="ts" setup>
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';
</script>

<template>
    <TestSection
        title="Uncaught error in @click handler"
        description="Throws synchronously inside an @click handler. Captured by flareVue via app.config.errorHandler with info='native event handler'."
    >
        <Button
            @click="
                () => {
                    console.log('Throwing error in @click handler');
                    throw new Error('Error in Vue @click handler');
                }
            "
        >
            Throw in @click
        </Button>
    </TestSection>
</template>
