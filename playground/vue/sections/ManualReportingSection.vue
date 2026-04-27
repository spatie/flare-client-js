<script lang="ts" setup>
import { flare } from '../../shared/initFlare';

import Button from '../components/Button.vue';
import TestSection from '../components/TestSection.vue';
</script>

<template>
    <TestSection
        title="Manual reporting API"
        description="Reports without relying on flareVue's handler or any boundary. `flare.report()` sends an Error, `flare.reportMessage()` sends a plain string, `flare.test()` sends a synthetic report to verify the connection."
        body-class="flex flex-wrap items-center gap-3"
    >
        <Button
            @click="
                () => {
                    console.log('Calling flare.report() from Vue component');
                    flare.report(new Error('Manually reported from Vue'));
                }
            "
        >
            flare.report() from component
        </Button>
        <Button
            @click="
                () => {
                    console.log('Calling flare.reportMessage()');
                    flare.reportMessage('This is a manually reported message from Vue');
                }
            "
        >
            flare.reportMessage()
        </Button>
        <Button
            @click="
                () => {
                    console.log('Calling flare.test() to verify connection');
                    flare.test();
                }
            "
        >
            flare.test()
        </Button>
    </TestSection>
</template>
