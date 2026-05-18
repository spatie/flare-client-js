import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageDir = process.argv[2];
if (!packageDir) {
    console.error('Usage: node scripts/generate-version.mjs <package-dir>');
    process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));
const outPath = join(packageDir, 'src', 'version.ts');

writeFileSync(
    outPath,
    `// generated during release, do not modify\nexport const PACKAGE_VERSION = '${pkg.version}';\n`,
);

console.log(`Wrote ${pkg.name}@${pkg.version} to ${outPath}`);
