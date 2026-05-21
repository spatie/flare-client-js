<script lang="ts">
    import { productById, testIds } from '@flareapp/playgrounds-shared';
    import { cart } from '$lib/cart.svelte';

    const totalCents = $derived(
        cart.lines.reduce((sum, line) => {
            const product = productById(line.productId);
            return product ? sum + product.priceCents * line.quantity : sum;
        }, 0),
    );
</script>

<section>
    <h1 class="text-xl font-semibold mb-6">Cart</h1>
    {#if cart.lines.length === 0}
        <p class="text-sm opacity-70">Cart is empty.</p>
    {:else}
        <table class="w-full text-left">
            <thead class="text-xs uppercase opacity-60">
                <tr>
                    <th class="py-2">Item</th>
                    <th class="py-2">Qty</th>
                    <th class="py-2">Subtotal</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                {#each cart.lines as line (line.productId)}
                    {@const product = productById(line.productId)}
                    {#if product}
                        <tr
                            data-testid={testIds.cartItem(product.id)}
                            class="border-b border-surface-border"
                        >
                            <td class="py-3">{product.title}</td>
                            <td class="py-3 font-mono text-sm">{line.quantity}</td>
                            <td class="py-3 font-mono text-sm">
                                ${((product.priceCents * line.quantity) / 100).toFixed(2)}
                            </td>
                            <td class="py-3 text-right">
                                <button
                                    type="button"
                                    onclick={() => cart.remove(product.id)}
                                    class="text-xs text-brand hover:underline"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    {/if}
                {/each}
            </tbody>
        </table>
        <div class="mt-6 flex items-center justify-between">
            <div class="text-sm">
                Total: <span class="font-mono">${(totalCents / 100).toFixed(2)}</span>
            </div>
            <a
                href="/checkout"
                class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm"
            >
                Checkout
            </a>
        </div>
    {/if}
</section>
