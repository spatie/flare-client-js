export type HttpScenario = {
    id: string;
    label: string;
    transport: 'fetch' | 'xhr';
};

// The SPA playgrounds have no server, so every scenario hits `/index.html`, which Vite serves as a
// real file (200) in both dev and preview. The Svelte playground keeps its own list because it has a
// real echo endpoint and can drive 404/500 as well.
export const sameOriginHttpScenarios: HttpScenario[] = [
    { id: 'fetch-ok', label: 'fetch: GET 200', transport: 'fetch' },
    { id: 'xhr-ok', label: 'XHR: GET 200', transport: 'xhr' },
];

// Same-origin URL carrying the scenario id, so a span can be matched on its `url.full`.
export const httpScenarioUrl = (id: string): string => `/index.html?scenario=${id}`;

// Fire one scenario, resolving with the `<id>:<status>` string the pages render into `httpResult`.
export const fireHttpScenario = (scenario: HttpScenario): Promise<string> => {
    const url = httpScenarioUrl(scenario.id);

    if (scenario.transport === 'fetch') {
        return fetch(url).then((response) => `${scenario.id}:${response.status}`);
    }

    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.addEventListener('loadend', () => resolve(`${scenario.id}:${xhr.status}`));
        xhr.send();
    });
};
