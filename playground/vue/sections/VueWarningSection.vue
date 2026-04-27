<script lang="ts" setup>
import { ref } from 'vue';

import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';
import WarnTrigger from '../components/WarnTrigger.vue';

const show = ref(false);
</script>

<template>
    <TestSection
        title="Vue warning capture (wrong prop type)"
        description="Passes a string to a prop typed as number, producing a Vue dev warning. Captured by flareVue when captureWarnings is enabled."
    >
        <Button
            @click="
                () => {
                    console.log('Triggering Vue warning via wrong prop type');
                    show = true;
                }
            "
        >
            Trigger Vue warning
        </Button>
        <div v-if="show" class="mt-3">
            <!-- @vue-ignore -->
            <WarnTrigger count="not-a-number" />
        </div>
    </TestSection>
</template>
