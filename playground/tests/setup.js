import fs from 'fs';
import path from 'path';

const playgrounds = ['js', 'react', 'vue'];

export function checkFlareKeys() {
    const missing = [];

    for (const name of playgrounds) {
        const envPath = path.resolve(import.meta.dirname, '..', name, '.env');

        if (!fs.existsSync(envPath)) {
            missing.push(`${name}/.env file missing`);
            continue;
        }

        const content = fs.readFileSync(envPath, 'utf-8');
        const match = content.match(/VITE_FLARE_KEY=(.+)/);

        if (!match || !match[1] || match[1].trim() === '' || match[1].includes('your-flare')) {
            missing.push(`${name}/.env has no valid VITE_FLARE_KEY`);
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `Flare API keys not configured:\n${missing.map((m) => `  - ${m}`).join('\n')}\n\nCopy .env.example to .env and fill in your project keys.`
        );
    }
}
