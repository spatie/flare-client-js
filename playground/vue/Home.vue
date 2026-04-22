<script lang="ts" setup>
import AsyncErrorSection from './sections/AsyncErrorSection.vue';
import AttachPropsSection from './sections/AttachPropsSection.vue';
import DenylistPropsSection from './sections/DenylistPropsSection.vue';
import EnrichmentSection from './sections/EnrichmentSection.vue';
import HooksSection from './sections/HooksSection.vue';
import LifecycleErrorSection from './sections/LifecycleErrorSection.vue';
import ManualReportingSection from './sections/ManualReportingSection.vue';
import NestedBoundariesSection from './sections/NestedBoundariesSection.vue';
import NonErrorThrowSection from './sections/NonErrorThrowSection.vue';
import OnClickErrorSection from './sections/OnClickErrorSection.vue';
import RenderErrorSection from './sections/RenderErrorSection.vue';
import ResetKeysSection from './sections/ResetKeysSection.vue';
import VueWarningSection from './sections/VueWarningSection.vue';
import WatcherErrorSection from './sections/WatcherErrorSection.vue';
</script>

<template>
    <RenderErrorSection />
    <ResetKeysSection />
    <OnClickErrorSection />
    <LifecycleErrorSection />
    <WatcherErrorSection />
    <AsyncErrorSection />
    <NonErrorThrowSection />
    <VueWarningSection />
    <AttachPropsSection />
    <DenylistPropsSection />
    <NestedBoundariesSection />
    <ManualReportingSection />
    <EnrichmentSection />
    <HooksSection />
</template>
