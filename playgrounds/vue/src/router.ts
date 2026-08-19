import { httpScenarioUrl } from '@flareapp/playgrounds-shared';
import { createRouter as createVueRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

import BrokenPage from './pages/BrokenPage.vue';
import CartPage from './pages/CartPage.vue';
import CheckoutPage from './pages/CheckoutPage.vue';
import ConfirmationPage from './pages/ConfirmationPage.vue';
import HttpPage from './pages/HttpPage.vue';
import ProductPage from './pages/ProductPage.vue';
import ProductsPage from './pages/ProductsPage.vue';

const routes: RouteRecordRaw[] = [
    { path: '/', name: 'products', component: ProductsPage },
    { path: '/product/:id', name: 'product', component: ProductPage },
    { path: '/cart', name: 'cart', component: CartPage },
    { path: '/checkout', name: 'checkout', component: CheckoutPage },
    { path: '/confirmation', name: 'confirmation', component: ConfirmationPage },
    { path: '/broken', name: 'broken', component: BrokenPage },
    {
        path: '/http',
        name: 'http',
        component: HttpPage,
        // traceVueRouter holds the nav root from beforeEach to afterEach (packages/vue/src/traceVueRouter.ts).
        // An awaited fetch in a route guard runs inside that window.
        beforeEnter: async () => {
            await fetch(httpScenarioUrl('loader-fetch'));
        },
    },
];

export const router = createVueRouter({
    history: createWebHistory(),
    routes,
});
