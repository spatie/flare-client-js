export type Product = {
    id: string;
    title: string;
    photographer: string;
    unsplashId: string;
    priceCents: number;
};

export const products: Product[] = [
    {
        id: 'p01',
        title: 'Alpine Dawn',
        photographer: 'Eberhard Grossgasteiger',
        unsplashId: '1506905925346-21bda4d32df4',
        priceCents: 2400,
    },
    {
        id: 'p02',
        title: 'Quiet Pier',
        photographer: 'Johannes Plenio',
        unsplashId: '1501785888041-af3ef285b470',
        priceCents: 1800,
    },
    {
        id: 'p03',
        title: 'Foggy Forest',
        photographer: 'Sebastian Unrau',
        unsplashId: '1441974231531-c6227db76b6e',
        priceCents: 2200,
    },
    {
        id: 'p04',
        title: 'Desert Light',
        photographer: 'NEOM',
        unsplashId: '1469474968028-56623f02e42e',
        priceCents: 2600,
    },
    {
        id: 'p05',
        title: 'Coastal Drift',
        photographer: 'Patrick Tomasso',
        unsplashId: '1490604001847-b712b0c2f967',
        priceCents: 1900,
    },
    {
        id: 'p06',
        title: 'City Lines',
        photographer: 'Annie Spratt',
        unsplashId: '1444723121867-7a241cacace9',
        priceCents: 2100,
    },
    {
        id: 'p07',
        title: 'Studio Still',
        photographer: 'Kelly Sikkema',
        unsplashId: '1487530811176-3780de880c2d',
        priceCents: 1700,
    },
    {
        id: 'p08',
        title: 'Northern Sky',
        photographer: 'Vincent Guth',
        unsplashId: '1483728642387-6c3bdd6c93e5',
        priceCents: 2800,
    },
    {
        id: 'p09',
        title: 'Stone Path',
        photographer: 'Eberhard Grossgasteiger',
        unsplashId: '1470770841072-f978cf4d019e',
        priceCents: 2000,
    },
    {
        id: 'p10',
        title: 'Open Field',
        photographer: 'Tobias Keller',
        unsplashId: '1493246507139-91e8fad9978e',
        priceCents: 1600,
    },
    {
        id: 'p11',
        title: 'River Bend',
        photographer: 'Luca Bravo',
        unsplashId: '1485470733090-0aae1788d5af',
        priceCents: 2300,
    },
    {
        id: 'p12',
        title: 'Last Light',
        photographer: 'Aleksandar Pasaric',
        unsplashId: '1500382017468-9049fed747ef',
        priceCents: 2500,
    },
];

export const productById = (id: string): Product | undefined => products.find((p) => p.id === id);
