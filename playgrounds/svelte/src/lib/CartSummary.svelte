<script lang="ts">
    import type { CartSummary } from '@flareapp/playgrounds-shared';
    import { displayTotalCents, formatMoney, testIds } from '@flareapp/playgrounds-shared';
    import { cart } from '$lib/cart.svelte';

    let { summary }: { summary: CartSummary } = $props();

    const totalCents = $derived(displayTotalCents(summary.lines));
</script>

<table class="w-full text-left">
    <thead class="text-xs uppercase opacity-60">
        <tr>
            <th class="py-2">Item</th>
            <th class="py-2">Qty</th>
            <th class="py-2">Price</th>
            <th></th>
        </tr>
    </thead>
    <tbody>
        {#each summary.lines as line (line.productId)}
            <tr data-testid={testIds.cartItem(line.productId)} class="border-b border-surface-border">
                <td class="py-3">{line.title}</td>
                <td class="py-3 font-mono text-sm">{line.quantity}</td>
                <td class="py-3 font-mono text-sm">{formatMoney(line.price)}</td>
                <td class="py-3 text-right">
                    <button
                        type="button"
                        onclick={() => cart.remove(line.productId)}
                        class="text-xs text-brand hover:underline"
                    >
                        Remove
                    </button>
                </td>
            </tr>
        {/each}
    </tbody>
</table>
<div class="mt-6 flex items-center justify-between">
    <div class="text-sm">
        Total: <span class="font-mono">{formatMoney({ amountCents: totalCents, currency: 'USD' })}</span>
    </div>
    <a href="/checkout" class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">Checkout</a>
</div>
