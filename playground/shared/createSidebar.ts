export function createSidebar(): void {
    const el = document.querySelector('[data-slot="sidebar"]');
    const active = el?.getAttribute('data-active');

    const getActive = (current: string) =>
        active === current ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900';

    el?.insertAdjacentHTML(
        'afterbegin',
        `
            <aside class="sticky top-0 flex flex-col gap-4  p-4">
                <p class="text-base font-bold text-gray-900">Flare Playground</p>
                <nav class="flex flex-1 flex-col gap-1">
                    <a href="/js/" class="rounded-md px-3 py-2 text-sm font-medium ${getActive('js')}">Vanilla JS</a>
                    <a href="/react/" class="rounded-md px-3 py-2 text-sm font-medium ${getActive('react')}">React</a>
                    <a href="/vue/" class="rounded-md px-3 py-2 text-sm font-medium ${getActive('vue')}">Vue</a>
                </nav>
            </aside>
        `
    );
}
