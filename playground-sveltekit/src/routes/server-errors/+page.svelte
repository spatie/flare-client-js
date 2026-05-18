<script lang="ts">
    import Button from '$lib/Button.svelte';
    import TestSection from '$lib/TestSection.svelte';

    let { data } = $props();
</script>

<h1 class="text-2xl font-bold">Server-Side Errors</h1>
<p class="text-sm text-gray-600">{data.message}</p>

<TestSection
    title="Server load error (500)"
    description="Navigates to this page with ?trigger=load, causing the server load function to throw. Caught by hooks.server.ts handleErrorWithFlare. Report should include route context from the RequestEvent."
>
    <a
        href="/server-errors?trigger=load"
        class="inline-flex items-center rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white"
    >
        Trigger server load error
    </a>
</TestSection>

<TestSection
    title="Expected error (404)"
    description="Navigates with ?trigger=expected, causing a SvelteKit error(404). This is a 4xx error and should NOT be reported to Flare (filtered by handleErrorWithFlare)."
>
    <a
        href="/server-errors?trigger=expected"
        class="inline-flex items-center rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white"
    >
        Trigger 404 error
    </a>
</TestSection>

<TestSection
    title="Form action error"
    description="Submits a form that throws on the server. Caught by hooks.server.ts handleErrorWithFlare."
>
    <form method="POST" action="?/failingAction">
        <Button type="submit">Submit failing form action</Button>
    </form>
</TestSection>
