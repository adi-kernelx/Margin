// Generates the sample document bundled with the demo build:
//   node scripts/make-demo-pdf.mjs
// Output: src/demo/assets/eigenvalues-primer.pdf (committed).
//
// Written with pdf-lib so the file is reproducible and carries no third-party
// content. Greek letters and operators are drawn with the standard Symbol
// font; everything else uses Times. The document has a nested outline so the
// demo's Outline panel has something real to show.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, StandardFonts, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/demo/assets/eigenvalues-primer.pdf');

const PAGE = { width: 595.28, height: 841.89 }; // A4
const MARGIN = 72;
const INK = rgb(0.07, 0.09, 0.12);
const SOFT = rgb(0.3, 0.34, 0.4);
const ACCENT = rgb(0.04, 0.37, 0.34);

const doc = await PDFDocument.create();
doc.setTitle('Eigenvalues — a short primer');
doc.setAuthor('Margin sample');
doc.setSubject('Sample document for the Margin demo');
doc.setCreationDate(new Date('2026-09-01T00:00:00Z'));
doc.setModificationDate(new Date('2026-09-01T00:00:00Z'));

const fonts = {
    body: await doc.embedFont(StandardFonts.TimesRoman),
    italic: await doc.embedFont(StandardFonts.TimesRomanItalic),
    bold: await doc.embedFont(StandardFonts.TimesRomanBold),
    sans: await doc.embedFont(StandardFonts.HelveticaBold),
    symbol: await doc.embedFont(StandardFonts.Symbol),
};

// Characters that must come from the Symbol font.
const SYMBOLS = new Set([...'λμσραβπΣΠ∫≤≥≠∞∈→⇒∂√∑−']);

let page;
let y;
const outline = []; // { title, pageRef, top, children: [] }

function newPage() {
    page = doc.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
    const number = doc.getPageCount();
    page.drawText(String(number), { x: PAGE.width / 2 - 3, y: 36, size: 10, font: fonts.body, color: SOFT });
}

function ensureSpace(height) {
    if (y - height < MARGIN) newPage();
}

// Splits text into runs so Greek and operators render with Symbol, and
// `_{..}` / `^{..}` render as sub- and superscripts.
function runs(text, font) {
    const out = [];
    let shift = 0;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if ((char === '_' || char === '^') && text[index + 1] === '{') {
            shift = char === '_' ? -1 : 1;
            index += 1;
            continue;
        }
        if (char === '}' && shift !== 0) {
            shift = 0;
            continue;
        }
        const runFont = SYMBOLS.has(char) ? fonts.symbol : font;
        const last = out[out.length - 1];
        if (last && last.font === runFont && last.shift === shift) last.text += char;
        else out.push({ text: char, font: runFont, shift });
    }
    return out;
}

const scriptSize = (size, run) => (run.shift ? size * 0.7 : size);

// Symbol glyphs sit tight against a preceding Times space; add a hair of air.
const leadIn = (run, previous, size) => (run.font === fonts.symbol && previous?.text.endsWith(' ') ? size * 0.12 : 0);

function widthOf(text, font, size) {
    return runs(text, font).reduce((sum, run, index, all) => sum + leadIn(run, all[index - 1], size) + run.font.widthOfTextAtSize(run.text, scriptSize(size, run)), 0);
}

function drawRuns(text, x, baseline, font, size, color) {
    let cursor = x;
    runs(text, font).forEach((run, index, all) => {
        const runSize = scriptSize(size, run);
        cursor += leadIn(run, all[index - 1], size);
        page.drawText(run.text, { x: cursor, y: baseline + run.shift * size * (run.shift > 0 ? 0.38 : 0.2), size: runSize, font: run.font, color });
        cursor += run.font.widthOfTextAtSize(run.text, runSize);
    });
}

function paragraph(text, { size = 11.5, font = fonts.body, color = INK, gap = 8, indent = 0 } = {}) {
    const width = PAGE.width - MARGIN * 2 - indent * 2;
    const lineHeight = size * 1.45;
    const words = text.split(/\s+/);
    let line = '';
    const lines = [];
    for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (widthOf(candidate, font, size) > width && line) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);
    for (const current of lines) {
        ensureSpace(lineHeight);
        y -= lineHeight;
        drawRuns(current, MARGIN + indent, y, font, size, color);
    }
    y -= gap;
}

function heading(text, level) {
    const size = level === 1 ? 20 : 14;
    ensureSpace(size * 3);
    y -= level === 1 ? 10 : 6;
    const top = y + 4;
    y -= size * 1.3;
    page.drawText(text, { x: MARGIN, y, size, font: level === 1 ? fonts.sans : fonts.bold, color: level === 1 ? ACCENT : INK });
    y -= level === 1 ? 12 : 6;
    const entry = { title: text, pageRef: page.ref, top, children: [] };
    if (level === 1) outline.push(entry);
    else outline[outline.length - 1].children.push(entry);
}

function equation(text, label) {
    const size = 13;
    ensureSpace(size * 2.6);
    y -= size * 1.9;
    const width = widthOf(text, fonts.italic, size);
    drawRuns(text, (PAGE.width - width) / 2, y, fonts.italic, size, INK);
    if (label) page.drawText(`(${label})`, { x: PAGE.width - MARGIN - 20, y, size: 11, font: fonts.body, color: SOFT });
    y -= size * 0.9;
}

function box(title, text) {
    const size = 11;
    const lines = Math.ceil(widthOf(text, fonts.body, size) / (PAGE.width - MARGIN * 2 - 28)) + 1;
    const height = lines * size * 1.45 + 30;
    ensureSpace(height + 12);
    y -= 6;
    page.drawRectangle({
        x: MARGIN, y: y - height, width: PAGE.width - MARGIN * 2, height,
        color: rgb(0.93, 0.96, 0.95), borderColor: ACCENT, borderWidth: 0.8,
    });
    y -= 20;
    page.drawText(title, { x: MARGIN + 14, y, size: 11, font: fonts.bold, color: ACCENT });
    y -= 2;
    paragraph(text, { size, indent: 14, gap: 0 });
    y -= 16;
}

// ── Content ──────────────────────────────────────────────────────────────

newPage();
page.drawText('Eigenvalues', { x: MARGIN, y: y - 30, size: 34, font: fonts.sans, color: INK });
page.drawText('a short primer', { x: MARGIN, y: y - 58, size: 18, font: fonts.italic, color: SOFT });
y -= 96;
paragraph('This sample document ships with the Margin demo. Highlight a sentence, attach it to a note, reorder the pages, or search for a word such as "determinant" — everything happens in this browser and nothing is uploaded.', { color: SOFT, gap: 18 });

heading('1  Definitions', 1);
paragraph('Let A be an n × n matrix over the real or complex numbers. A non-zero vector v is an eigenvector of A when multiplying by A only rescales it. The scale factor is the corresponding eigenvalue.');
equation('A v = λ v,   v ≠ 0', '1.1');
paragraph('Geometrically, an eigenvector spans a line that A maps onto itself. The eigenvalue λ records how that line is stretched, flipped, or collapsed.');

heading('1.1  The characteristic polynomial', 2);
paragraph('Rewriting (1.1) as (A − λ I) v = 0 shows that a non-zero solution exists exactly when A − λ I is singular, that is, when its determinant vanishes.');
equation('p(λ) = det(A − λ I) = 0', '1.2');
paragraph('The polynomial p has degree n, so A has exactly n eigenvalues counted with multiplicity over the complex numbers.');
box('Definition — spectrum', 'The set of eigenvalues of A is called its spectrum and is written σ(A). The largest absolute value in σ(A) is the spectral radius.');

heading('1.2  A worked example', 2);
paragraph('Take the 2 × 2 matrix with rows (2, 1) and (1, 2). Its characteristic polynomial is');
equation('(2 − λ)² − 1 = λ² − 4λ + 3 = (λ − 1)(λ − 3)', '1.3');
paragraph('so σ(A) = {1, 3}. The eigenvector for λ = 3 is (1, 1): the matrix stretches the diagonal by three. The eigenvector for λ = 1 is (1, −1): the anti-diagonal is left unchanged.');

heading('2  Properties', 1);
heading('2.1  Trace and determinant', 2);
paragraph('Comparing coefficients of p(λ) with the product of its linear factors gives two identities that are often the quickest sanity check on a calculation.');
equation('tr A = Σ λ_{i} ,     det A = Π λ_{i}', '2.1');
paragraph('In the example above the trace is 4 = 1 + 3 and the determinant is 3 = 1 · 3.');

heading('2.2  Symmetric matrices', 2);
paragraph('When A equals its transpose every eigenvalue is real, and eigenvectors belonging to distinct eigenvalues are orthogonal. This is the spectral theorem, and it is why symmetric matrices can always be diagonalised by a rotation.');
box('Theorem — spectral theorem', 'If A is real and symmetric there is an orthogonal matrix Q and a real diagonal matrix D with A = Q D Q^{T}. The columns of Q are orthonormal eigenvectors of A.');

heading('2.3  Powers and stability', 2);
paragraph('If A = Q D Q^{−1} then A^{k} = Q D^{k} Q^{−1}, so repeated application of A is governed by the powers of its eigenvalues. The iteration x_{k+1} = A x_{k} tends to zero for every start exactly when the spectral radius is below one.');
equation('ρ(A) < 1   ⇒   A^{k} x → 0   as   k → ∞', '2.2');

heading('3  Computing eigenvalues', 1);
heading('3.1  Power iteration', 2);
paragraph('Starting from a random vector and repeatedly multiplying by A, then normalising, converges to the eigenvector of the eigenvalue with largest absolute value, provided that eigenvalue is strictly dominant. The convergence rate is the ratio of the two largest eigenvalues in absolute value.');
equation('x_{k+1} = A x_{k} / |A x_{k}|', '3.1');

heading('3.2  The QR algorithm', 2);
paragraph('Practical libraries use the QR algorithm: factor A = Q R, form R Q, and repeat. Each step is a similarity transform, so the spectrum is preserved, and the iterates converge to an upper-triangular matrix whose diagonal holds the eigenvalues.');
box('Exercise', 'Find the eigenvalues of the matrix with rows (0, 1) and (−1, 0). Why are they not real, and what does the matrix do geometrically?');

heading('Further reading', 1);
paragraph('G. Strang, Introduction to Linear Algebra, chapter 6. L. N. Trefethen and D. Bau, Numerical Linear Algebra, lectures 24 to 29.');

// ── Outline ──────────────────────────────────────────────────────────────

function addOutline(entries) {
    const context = doc.context;
    const rootRef = context.nextRef();

    function build(items, parentRef) {
        const refs = items.map(() => context.nextRef());
        let count = 0;
        items.forEach((item, index) => {
            const dest = PDFArray.withContext(context);
            dest.push(item.pageRef);
            dest.push(PDFName.of('XYZ'));
            dest.push(PDFNull);
            dest.push(PDFNumber.of(item.top));
            dest.push(PDFNull);
            const dict = context.obj({ Title: PDFHexString.fromText(item.title), Parent: parentRef, Dest: dest });
            if (index > 0) dict.set(PDFName.of('Prev'), refs[index - 1]);
            if (index < items.length - 1) dict.set(PDFName.of('Next'), refs[index + 1]);
            if (item.children.length) {
                const child = build(item.children, refs[index]);
                dict.set(PDFName.of('First'), child.first);
                dict.set(PDFName.of('Last'), child.last);
                dict.set(PDFName.of('Count'), PDFNumber.of(-child.count)); // collapsed by default
            }
            context.assign(refs[index], dict);
            count += 1;
        });
        return { first: refs[0], last: refs[refs.length - 1], count };
    }

    const top = build(entries, rootRef);
    context.assign(rootRef, context.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: PDFNumber.of(top.count) }));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
}

addOutline(outline);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, await doc.save({ useObjectStreams: false }));
console.log(`Wrote ${OUT} (${doc.getPageCount()} pages, ${outline.length} top-level outline entries)`);
