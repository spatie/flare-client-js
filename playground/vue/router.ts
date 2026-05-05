import { createRouter, createWebHashHistory } from 'vue-router';

import Home from './Home.vue';
import UserProfile from './UserProfile.vue';

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', name: 'home', component: Home },
        { path: '/users/:id', name: 'user-profile', component: UserProfile },
    ],
});
