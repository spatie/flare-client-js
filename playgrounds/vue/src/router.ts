import { createRouter as createVueRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import BrokenPage from './pages/BrokenPage.vue';
import CartPage from './pages/CartPage.vue';
import CheckoutPage from './pages/CheckoutPage.vue';
import ConfirmationPage from './pages/ConfirmationPage.vue';
import ProductPage from './pages/ProductPage.vue';
import ProductsPage from './pages/ProductsPage.vue';

const routes: RouteRecordRaw[] = [
    { path: '/', name: 'products', component: ProductsPage },
    { path: '/product/:id', name: 'product', component: ProductPage },
    { path: '/cart', name: 'cart', component: CartPage },
    { path: '/checkout', name: 'checkout', component: CheckoutPage },
    { path: '/confirmation', name: 'confirmation', component: ConfirmationPage },
    { path: '/broken', name: 'broken', component: BrokenPage },
];

export const router = createVueRouter({
    history: createWebHistory(),
    routes,
});
