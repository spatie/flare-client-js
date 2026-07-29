<script lang="ts">
    import { testIds } from '@flareapp/playgrounds-shared';

    import { cart } from '$lib/cart.svelte';

    let { productId }: { productId: string } = $props();
</script>

<button
    type="button"
    data-testid={testIds.addToCart(productId)}
    onclick={() => cart.add(productId)}
    class="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
>
    Add to cart
</button>
