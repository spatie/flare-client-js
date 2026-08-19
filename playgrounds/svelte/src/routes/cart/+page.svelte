<script lang="ts">
    import type { CartSummary as CartSummaryData } from '@flareapp/playgrounds-shared';
    import { shopApi } from '@flareapp/playgrounds-shared';
    import { cart } from '$lib/cart.svelte';
    import CartSummary from '$lib/CartSummary.svelte';

    let summary = $state<CartSummaryData | null>(null);

    $effect(() => {
        const lines = cart.lines.map((line) => ({ ...line }));
        if (lines.length === 0) {
            summary = null;
            return;
        }

        let cancelled = false;
        void shopApi.cartSummary(lines).then((result) => {
            if (!cancelled) summary = result;
        });

        return () => {
            cancelled = true;
        };
    });
</script>

<section>
    <h1 class="text-xl font-semibold mb-6">Cart</h1>
    {#if cart.lines.length === 0}
        <p class="text-sm opacity-70">Cart is empty.</p>
    {:else if summary}
        <CartSummary {summary} />
    {:else}
        <p class="text-sm opacity-60">Pricing your cart…</p>
    {/if}
</section>
