<script setup>
import { flare } from '@flareapp/js';
import { ref } from 'vue';

import BrokenComponent from './BrokenComponent.vue';

const status = ref(null);
const showBroken = ref(false);

function showSuccess(msg) {
    status.value = { message: msg, error: false };
}

function showError(msg) {
    status.value = { message: msg, error: true };
}

async function testConnection() {
    try {
        await flare.test();
        showSuccess('Test report sent successfully!');
    } catch (e) {
        showError(`Failed: ${e.message}`);
    }
}

function triggerRenderError() {
    showBroken.value = true;
}

async function manualReport() {
    try {
        await flare.report(new Error('Manually reported error from Vue playground'));
        showSuccess('Manual report sent!');
    } catch (e) {
        showError(`Failed: ${e.message}`);
    }
}

async function customContext() {
    flare.addContext('playground', 'vue');
    flare.addContext('testId', crypto.randomUUID());
    flare.addContextGroup('user', {
        name: 'Test User',
        email: 'test@example.com',
    });

    try {
        await flare.report(new Error('Error with custom context from Vue playground'));
        showSuccess('Report with custom context sent!');
    } catch (e) {
        showError(`Failed: ${e.message}`);
    }
}

async function reportMessage() {
    try {
        await flare.reportMessage('Test message from Vue playground', {
            context: { source: 'playground-vue' },
        });
        showSuccess('Message report sent!');
    } catch (e) {
        showError(`Failed: ${e.message}`);
    }
}
</script>

<template>
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px">
        <h1>Flare Vue Playground</h1>
        <p>Test error reporting for <code>@flareapp/vue</code> with <code>flareVue</code> plugin.</p>

        <div style="display: flex; flex-direction: column; gap: 8px">
            <button class="btn" @click="testConnection">Test Connection</button>
            <button class="btn" @click="triggerRenderError">Trigger Component Render Error (flareVue)</button>
            <button class="btn" @click="manualReport">Manual Error Report</button>
            <button class="btn" @click="customContext">Error with Custom Context</button>
            <button class="btn" @click="reportMessage">Report Message (non-error)</button>
        </div>

        <BrokenComponent v-if="showBroken" />

        <div
            v-if="status"
            style="margin-top: 20px; padding: 12px; border-radius: 6px"
            :style="{
                background: status.error ? '#f8d7da' : '#d4edda',
                color: status.error ? '#721c24' : '#155724',
            }"
        >
            {{ status.message }}
        </div>
    </div>
</template>

<style>
.btn {
    padding: 12px;
    font-size: 16px;
    cursor: pointer;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #f5f5f5;
}
.btn:hover {
    background: #e0e0e0;
}
</style>
