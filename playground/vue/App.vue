<script lang="ts" setup>
import { FlareErrorBoundary } from '@flareapp/vue';
import { ref } from 'vue';

import { flare } from '../shared/initFlare';

import AsyncErrorButton from './AsyncErrorButton.vue';
import BuggyComponent from './BuggyComponent.vue';
import Button from './Button.vue';
import ResetKeysTest from './ResetKeysTest.vue';

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
    <FlareErrorBoundary
        v-if="showBuggy"
        :before-evaluate="
            ({ error, info }) => {
                console.log(`FlareErrorBoundary beforeEvaluate: ${error.message} (${info})`);
                flare.addContext('playground', 'vue-test');
            }
        "
        :before-submit="
            ({ error, context }) => {
                console.log(`FlareErrorBoundary beforeSubmit: ${error.message}`);
                return {
                    ...context,
                    vue: {
                        ...context.vue,
                        componentHierarchy: [...context.vue.componentHierarchy, 'injected-by-beforeSubmit'],
                    },
                };
            }
        "
        :after-submit="
            ({ error, info }) => {
                console.log(`FlareErrorBoundary afterSubmit: ${error.message} (${info}) reported to Flare`);
            }
        "
        :on-reset="
            (error) => {
                console.log(`FlareErrorBoundary onReset: recovering from ${error?.message}`);
            }
        "
    >
        <BuggyComponent />
        <template #fallback="{ error, componentHierarchy, resetErrorBoundary }">
            <div class="space-y-1">
                <p>Something went wrong: {{ error.message }}</p>
                <p class="text-xs text-gray-500">Hierarchy: {{ componentHierarchy.join(' > ') }}</p>
                <button
                    class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                    @click="resetErrorBoundary"
                >
                    Try again
                </button>
            </div>
        </template>
    </FlareErrorBoundary>
    <ResetKeysTest />
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
    <AsyncErrorButton />
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
    <Button
        @click="
            () => {
                console.log('Adding glows then reporting error');
                flare.glow('User clicked checkout', 'info', { page: '/checkout' });
                flare.glow('Payment form submitted', 'info', { method: 'credit_card' });
                flare.glow('Payment API responded', 'error', { status: 500 });
                flare.report(new Error('Payment processing failed'));
            }
        "
    >
        Error with glows
    </Button>
    <Button
        @click="
            () => {
                console.log('Adding custom context then reporting error');
                flare.addContext('user_id', 'usr_12345');
                flare.addContext('plan', 'pro');
                flare.addContextGroup('feature_flags', {
                    new_checkout: true,
                    dark_mode: false,
                });
                flare.report(new Error('Error with custom context attached'));
            }
        "
    >
        Error with custom context
    </Button>
    <Button
        @click="
            () => {
                const original = flare.config.beforeEvaluate;
                flare.configure({
                    beforeEvaluate: (error) => {
                        console.log(`beforeEvaluate: suppressing error '${error.message}'`);
                        return null as any;
                    },
                });
                flare.report(new Error('This error should be suppressed'));
                console.log('Error was suppressed by beforeEvaluate');
                flare.configure({ beforeEvaluate: original });
            }
        "
    >
        beforeEvaluate (suppress)
    </Button>
    <Button
        @click="
            () => {
                const original = flare.config.beforeSubmit;
                flare.configure({
                    beforeSubmit: (report) => {
                        report.context = {
                            ...report.context,
                            custom_hook: { injected_by: 'beforeSubmit hook', timestamp: Date.now() },
                        };
                        console.log('beforeSubmit: added custom_hook context to report');
                        return report;
                    },
                });
                flare.report(new Error('Error modified by beforeSubmit'));
                flare.configure({ beforeSubmit: original });
            }
        "
    >
        beforeSubmit (modify)
    </Button>
</template>
