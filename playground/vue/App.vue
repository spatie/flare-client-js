<script lang="ts" setup>
import { ref } from 'vue';
import Button from './Button.vue';
import BuggyComponent from './BuggyComponent.vue';
import { flare } from '../shared/initFlare';

const showBuggy = ref(false);
</script>

<template>
    <Button
        @click="
            () => {
                console.log('Triggering render error via BuggyComponent');
                showBuggy = true;
            }
        "
    >
        Trigger render error
    </Button>
    <Button
        @click="
            () => {
                showBuggy = false;
                console.log('Reset BuggyComponent state');
            }
        "
    >
        Reset render error
    </Button>
    <BuggyComponent v-if="showBuggy" />
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
    <Button
        @click="
            () => {
                console.log('Triggering async error');
                Promise.reject(new Error('Async error in Vue component'));
            }
        "
    >
        Async error (unhandled rejection)
    </Button>
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
                console.log('Triggering named component render error');
                showBuggy = true;
            }
        "
    >
        Trigger named component error
    </Button>
</template>
