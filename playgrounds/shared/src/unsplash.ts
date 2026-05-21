export const unsplashUrl = (unsplashId: string, w: number, h: number): string =>
    `https://images.unsplash.com/photo-${unsplashId}?w=${w}&h=${h}&fit=crop&auto=format`;
