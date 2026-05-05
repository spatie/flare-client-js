<script lang="ts" setup>
import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';
</script>

<template>
    <TestSection
        title="Non-Error value thrown (convertToError)"
        description="Throws a plain string instead of an Error instance. Verifies the client's convertToError path wraps it into a proper Error before reporting."
    >
        <Button
            @click="
                () => {
                    console.log('Throwing a plain string (not an Error instance)');
                    // eslint-disable-next-line @typescript-eslint/no-throw-literal
                    throw 'plain string thrown from Vue @click (not an Error instance)';
                }
            "
        >
            Throw non-Error value
        </Button>
    </TestSection>
</template>
