export type Swatch = { hex: string; share: number };

const SAMPLE_PIXELS = 3000;
const CLUSTERS = 5;
const KMEANS_PASSES = 12;

/**
 * Groups a photograph's colours into its dominant swatches, using k-means with random restarts and
 * keeping the tightest result.
 *
 * Deliberately slow: it keeps restarting until the time budget is gone, far past the point where the
 * result stops improving. This is the playground's one component that is expensive enough to read as
 * a wide bar in a component trace. Budgeted on the clock rather than on a pass count, so the span is
 * the same length on a throttled CPU as on a fast one.
 */
export function extractPalette(seed: string, budgetMs = 1500): Swatch[] {
    const random = mulberry32(hashSeed(seed));
    const pixels = samplePixels(random);

    const deadline = Date.now() + budgetMs;
    let best = cluster(pixels, random);
    do {
        const attempt = cluster(pixels, random);
        if (attempt.inertia < best.inertia) {
            best = attempt;
        }
    } while (Date.now() < deadline);

    return best.centroids
        .map((centroid, index) => ({ hex: toHex(centroid), share: best.counts[index] / pixels.length }))
        .filter((swatch) => swatch.share > 0)
        .sort((a, b) => b.share - a.share);
}

type Rgb = [number, number, number];
type Clustering = { centroids: Rgb[]; counts: number[]; inertia: number };

/** Deterministic PRNG, so the same photograph always produces the same palette. */
function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(text: string): number {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
}

/** Pixels drawn around three base hues, which is roughly how a photograph's colours sit. */
function samplePixels(random: () => number): Rgb[] {
    const baseHues = [random() * 360, random() * 360, random() * 360];
    const pixels: Rgb[] = [];
    for (let i = 0; i < SAMPLE_PIXELS; i++) {
        const hue = (baseHues[i % baseHues.length] + (random() - 0.5) * 40 + 360) % 360;
        pixels.push(hslToRgb(hue, 0.2 + random() * 0.5, 0.25 + random() * 0.55));
    }
    return pixels;
}

function cluster(pixels: Rgb[], random: () => number): Clustering {
    let centroids: Rgb[] = Array.from({ length: CLUSTERS }, () => pixels[Math.floor(random() * pixels.length)]);
    let counts = new Array<number>(CLUSTERS).fill(0);
    let inertia = 0;

    for (let pass = 0; pass < KMEANS_PASSES; pass++) {
        const sums: Rgb[] = Array.from({ length: CLUSTERS }, () => [0, 0, 0]);
        counts = new Array<number>(CLUSTERS).fill(0);
        inertia = 0;

        for (const pixel of pixels) {
            let nearest = 0;
            let nearestDistance = Infinity;
            for (let c = 0; c < CLUSTERS; c++) {
                const distance = squaredDistance(pixel, centroids[c]);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearest = c;
                }
            }
            sums[nearest][0] += pixel[0];
            sums[nearest][1] += pixel[1];
            sums[nearest][2] += pixel[2];
            counts[nearest]++;
            inertia += nearestDistance;
        }

        centroids = sums.map((sum, index) =>
            counts[index] === 0
                ? centroids[index]
                : ([sum[0] / counts[index], sum[1] / counts[index], sum[2] / counts[index]] as Rgb),
        );
    }

    return { centroids, counts, inertia };
}

function squaredDistance(a: Rgb, b: Rgb): number {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = lightness - chroma / 2;
    const [r, g, b] =
        hue < 60
            ? [chroma, secondary, 0]
            : hue < 120
              ? [secondary, chroma, 0]
              : hue < 180
                ? [0, chroma, secondary]
                : hue < 240
                  ? [0, secondary, chroma]
                  : hue < 300
                    ? [secondary, 0, chroma]
                    : [chroma, 0, secondary];
    return [(r + match) * 255, (g + match) * 255, (b + match) * 255];
}

function toHex(rgb: Rgb): string {
    return `#${rgb
        .map((channel) =>
            Math.round(Math.min(255, Math.max(0, channel)))
                .toString(16)
                .padStart(2, '0'),
        )
        .join('')}`;
}
