import './styles.css';
import { initFlare } from './flare';
import { updateCartBadge } from './layout';
import { renderBroken } from './pages/broken';
import { renderCart } from './pages/cart';
import { renderCheckout } from './pages/checkout';
import { renderConfirmation } from './pages/confirmation';
import { renderProduct } from './pages/product';
import { renderProducts } from './pages/products';
import { createRouter } from './router';
import { cart } from './state';

initFlare();

const root = document.getElementById('app');
if (!root) throw new Error('No #app root element');

const router = createRouter(root);

router.on('/', renderProducts);
router.on('/product/:id', renderProduct);
router.on('/cart', renderCart);
router.on('/checkout', renderCheckout);
router.on('/confirmation', renderConfirmation);
router.on('/broken', renderBroken);
router.fallback((_match, target) => {
    target.innerHTML = `<p class="p-8 text-center text-sm">Not found</p>`;
});

cart.subscribe(updateCartBadge);

void router.start();
