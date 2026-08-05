<script lang="ts">
    import { goto } from '$app/navigation';
    import type { CartSummary } from '@flareapp/playgrounds-shared';
    import { formatMoney, journeyGlows, placeOrder, recordGlow, shopApi, testIds } from '@flareapp/playgrounds-shared';
    import { onMount } from 'svelte';
    import { cart } from '$lib/cart.svelte';
    import { flare } from '$lib/flare.client';

    let summary = $state<CartSummary | null>(null);

    onMount(async () => {
        summary = await shopApi.cartSummary(cart.lines);
        recordGlow(flare, journeyGlows.openedCheckout(summary.lines.length));
    });

    const onSubmit = (event: SubmitEvent): void => {
        event.preventDefault();
        if (!summary) return;

        // Throws synchronously when the cart holds the unpriced product, which is the showcase error.
        void placeOrder(summary).then(() => {
            cart.clear();
            void goto('/confirmation');
        });
    };
</script>

<section class="max-w-md mx-auto">
    <h1 class="text-xl font-semibold mb-6">Checkout</h1>
    <ul class="mb-6 flex flex-col gap-1 text-sm">
        {#each summary?.lines ?? [] as line (line.productId)}
            <li class="flex justify-between">
                <span>{line.title} x{line.quantity}</span>
                <span class="font-mono">{formatMoney(line.price)}</span>
            </li>
        {/each}
    </ul>
    <form onsubmit={onSubmit} class="flex flex-col gap-4">
        <label class="flex flex-col gap-1 text-sm">
            Name
            <input
                name="name"
                required
                value="Iris De Witte"
                class="rounded border border-surface-border px-3 py-2"
            />
        </label>
        <label class="flex flex-col gap-1 text-sm">
            Email
            <input
                name="email"
                type="email"
                required
                value="iris.dewitte@example.com"
                class="rounded border border-surface-border px-3 py-2"
            />
        </label>
        <label class="flex flex-col gap-1 text-sm">
            Card number
            <input
                name="card"
                required
                value="4242 4242 4242 4242"
                class="rounded border border-surface-border px-3 py-2 font-mono"
            />
        </label>
        <!-- Disabled until the summary lands, so paying can never silently no-op. -->
        <button
            type="submit"
            disabled={!summary}
            data-testid={testIds.checkoutSubmit}
            class="rounded-lg bg-brand-ink text-white py-2 text-sm disabled:opacity-50"
        >
            Pay
        </button>
    </form>
</section>
