type Params = {
    title: string;
    description: string;
    bodyClass?: string;
};

export function createTestSection(parent: HTMLElement, { title, description, bodyClass }: Params): HTMLElement {
    const section = document.createElement('section');
    section.className = 'border-t border-gray-200 py-6 first:border-t-0 first:pt-0';

    const heading = document.createElement('h2');
    heading.className = 'text-base font-semibold text-gray-900';
    heading.textContent = title;
    section.appendChild(heading);

    const paragraph = document.createElement('p');
    paragraph.className = 'mt-1 text-sm text-gray-600';
    paragraph.textContent = description;
    section.appendChild(paragraph);

    const body = document.createElement('div');
    body.className = `mt-3 ${bodyClass}`;
    section.appendChild(body);

    parent.appendChild(section);

    return body;
}
