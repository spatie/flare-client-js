type Params = {
    text: string;
    onClick: () => void;
};

export function createButton({ text, onClick }: Params) {
    const el = document.querySelector('[data-slot="tests"]');
    const button = document.createElement('button');

    button.className =
        'cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200';
    button.textContent = text;
    button.addEventListener('click', onClick);

    el?.appendChild(button);
}
