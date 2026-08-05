import { withFlareConfig } from '@flareapp/svelte/config';
import adapter from '@sveltejs/adapter-node';

export default withFlareConfig(
    { kit: { adapter: adapter() } },
    {
        profileComponents: [
            /\+(page|layout)(@[^/]*)?$/,
            'AddToCartButton',
            'ProductGrid',
            'ProductCard',
            'CartSummary',
        ],
    },
);
