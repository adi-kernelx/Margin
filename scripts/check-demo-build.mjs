// Guards the split between the normal and demo builds:
//   node scripts/check-demo-build.mjs
// Run after `vite build` and `vite build --mode demo`. Fails when demo-only
// code leaks into the normal build, or when service code leaks into the demo.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assets(dir) {
    const path = join(root, dir, 'assets');
    if (!existsSync(path)) {
        failures.push(`${dir}/ is missing — build it first`);
        return [];
    }
    return readdirSync(path).map(name => ({ name, path: join(path, name) }));
}

function scriptsContaining(files, needle) {
    return files
        .filter(file => file.name.endsWith('.js'))
        .filter(file => readFileSync(file.path, 'utf8').includes(needle))
        .map(file => file.name);
}

// Normal build: no showcase, banner or sample document.
const normal = assets('dist');
for (const file of normal) {
    if (/^(DemoShowcase|DemoBanner|eigenvalues-primer)/.test(file.name)) failures.push(`dist contains demo file ${file.name}`);
}

// Demo build: the showcase ships, and nothing talks to a local service.
const demo = assets('dist-demo');
if (demo.length) {
    if (!demo.some(file => file.name.startsWith('DemoShowcase'))) failures.push('dist-demo is missing the showcase chunk');
    if (!demo.some(file => file.name.startsWith('eigenvalues-primer') && file.name.endsWith('.pdf'))) failures.push('dist-demo is missing the sample PDF');
    for (const needle of ['localhost:8000', 'localhost:9101', 'tesseract']) {
        const hits = scriptsContaining(demo, needle);
        if (hits.length) failures.push(`dist-demo references "${needle}" in ${hits.join(', ')}`);
    }
    const html = readFileSync(join(root, 'dist-demo', 'index.html'), 'utf8');
    if (/(src|href)="\/assets\//.test(html)) failures.push('dist-demo/index.html uses absolute asset paths; static sub-path hosting will break');
}

if (failures.length) {
    console.error(`Demo build check failed:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
}
console.log(`Demo build check passed (${normal.length} normal assets, ${demo.length} demo assets).`);
