<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte';

    import HeaderBuggyButton from '../components/HeaderBuggyButton.svelte';
    import SidebarBuggyButton from '../components/SidebarBuggyButton.svelte';
    import TestSection from '../components/TestSection.svelte';

    let triggerInSidebar = $state(false);
    let triggerInHeader = $state(false);
</script>

<TestSection
    title="Component tree disambiguation (multi-instance)"
    description="Same BuggyButton component rendered inside two different parent wrappers (SidebarBuggyButton and HeaderBuggyButton). Each boundary should report the correct parent hierarchy for its subtree."
>
    <div class="grid grid-cols-2 gap-4">
        <div class="rounded-md border border-gray-200 bg-white p-3">
            <p class="mb-2 text-xs font-medium text-gray-500">Sidebar</p>
            <FlareErrorBoundary
                afterSubmit={({ context }) => {
                    console.log('Sidebar boundary reported. Hierarchy:', context.svelte.componentHierarchy);
                }}
            >
                <SidebarBuggyButton shouldThrow={triggerInSidebar} />

                {#snippet failed(error, reset)}
                    <div class="space-y-1">
                        <p class="text-sm text-red-700">Sidebar caught: {error.message}</p>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            onclick={() => {
                                triggerInSidebar = false;
                                reset();
                            }}
                        >
                            Reset Sidebar
                        </button>
                    </div>
                {/snippet}
            </FlareErrorBoundary>
            <button
                class="mt-2 cursor-pointer rounded-md bg-red-50 px-3 py-1 text-xs text-red-700 transition hover:bg-red-100"
                onclick={() => (triggerInSidebar = true)}
            >
                Trigger error in Sidebar
            </button>
        </div>

        <div class="rounded-md border border-gray-200 bg-white p-3">
            <p class="mb-2 text-xs font-medium text-gray-500">Header</p>
            <FlareErrorBoundary
                afterSubmit={({ context }) => {
                    console.log('Header boundary reported. Hierarchy:', context.svelte.componentHierarchy);
                }}
            >
                <HeaderBuggyButton shouldThrow={triggerInHeader} />

                {#snippet failed(error, reset)}
                    <div class="space-y-1">
                        <p class="text-sm text-red-700">Header caught: {error.message}</p>
                        <button
                            class="rounded-md bg-black px-2 py-1 text-sm font-medium text-white"
                            onclick={() => {
                                triggerInHeader = false;
                                reset();
                            }}
                        >
                            Reset Header
                        </button>
                    </div>
                {/snippet}
            </FlareErrorBoundary>
            <button
                class="mt-2 cursor-pointer rounded-md bg-red-50 px-3 py-1 text-xs text-red-700 transition hover:bg-red-100"
                onclick={() => (triggerInHeader = true)}
            >
                Trigger error in Header
            </button>
        </div>
    </div>
    <p class="mt-2 text-xs text-gray-500">
        Check the console: each boundary should log a different componentHierarchy reflecting its own parent wrapper.
    </p>
</TestSection>
