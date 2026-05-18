import { error } from '@sveltejs/kit';

import type { Actions } from './$types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
    const trigger = url.searchParams.get('trigger');

    if (trigger === 'load') {
        throw new Error('Server load function error');
    }

    if (trigger === 'expected') {
        error(404, 'This page does not exist');
    }

    return {
        message: 'Server load succeeded. Use the buttons below to trigger server-side errors.',
    };
};

export const actions: Actions = {
    failingAction: () => {
        throw new Error('Form action error on server');
    },
};
