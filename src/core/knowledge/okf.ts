// Pure helpers for a document's Open Knowledge Format (OKF v0.2) bundle.
//
// The RAG service's POST /bundle returns the bundle's files (Markdown with YAML
// frontmatter) and the same concepts as plain records, so the panel never has to
// parse YAML. The one write the reader makes is a human verification, which this
// module applies to both: a `verified` entry in the concept's frontmatter and a
// line in log.md, so an exported bundle records who checked what and when.

export interface Verification {
    /** OKF actor: `human:<id>` for a person. */
    by: string;
    /** ISO 8601 timestamp with a UTC offset. */
    at: string;
}

export interface ConceptRecord {
    /** Bundle-relative path, e.g. `definitions/plane-tree.md`. */
    path: string;
    type: string;
    title: string;
    description: string;
    /** One-based page in the original PDF. */
    page: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    method: 'heading' | 'detector' | string;
    confidence: number;
    proofPages: number[];
    /** Paths of the concepts this one refers to. */
    uses: string[];
    verified?: Verification[];
}

export interface KnowledgeBundle {
    documentId: string;
    /** PDF.js `fingerprints[0]` of the PDF the bundle was built from. */
    fingerprint: string;
    fileName: string;
    builtAt: string;
    summary: { concepts: number; links: number; blocks?: number; types?: Record<string, number> };
    files: Record<string, string>;
    concepts: ConceptRecord[];
}

export type ConceptGroup = 'Definitions' | 'Notation' | 'Results' | 'Algorithms';

export const GROUP_ORDER: readonly ConceptGroup[] = ['Definitions', 'Notation', 'Results', 'Algorithms'];

export function groupOf(type: string): ConceptGroup {
    if (type === 'Definition') return 'Definitions';
    if (type === 'Notation') return 'Notation';
    if (type === 'Algorithm') return 'Algorithms';
    return 'Results';
}

export function isVerified(concept: ConceptRecord): boolean {
    return (concept.verified?.length ?? 0) > 0;
}

/** Concepts whose title or description contains every word of the query, in page order. */
export function filterConcepts(concepts: readonly ConceptRecord[], query: string): ConceptRecord[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = concepts.filter(concept => {
        const text = `${concept.title} ${concept.description} ${concept.type}`.toLowerCase();
        return words.every(word => text.includes(word));
    });
    return [...matches].sort((a, b) => a.page - b.page || a.title.localeCompare(b.title));
}

/** Non-empty groups in reading order (Definitions, Notation, Results, Algorithms). */
export function groupConcepts(concepts: readonly ConceptRecord[]): { group: ConceptGroup; concepts: ConceptRecord[] }[] {
    return GROUP_ORDER
        .map(group => ({ group, concepts: concepts.filter(concept => groupOf(concept.type) === group) }))
        .filter(entry => entry.concepts.length > 0);
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

function verificationLines(entry: Verification): string[] {
    return [`- by: ${entry.by}`, `  at: '${entry.at}'`];
}

/**
 * Adds a `verified` entry to a concept file's frontmatter. An existing list is
 * extended; otherwise the key is inserted before `status` (or at the end).
 * Throws when the file has no frontmatter, rather than writing a broken file.
 */
export function addVerification(markdown: string, entry: Verification): string {
    const match = FRONTMATTER.exec(markdown);
    if (!match) throw new Error('Concept file has no frontmatter');
    const lines = match[1].split('\n');
    const start = lines.findIndex(line => /^verified:\s*$/.test(line));
    if (start >= 0) {
        let end = start + 1;
        while (end < lines.length && /^(?:- |\s{2})/.test(lines[end])) end += 1;
        lines.splice(end, 0, ...verificationLines(entry));
    } else {
        const status = lines.findIndex(line => /^status:/.test(line));
        lines.splice(status >= 0 ? status : lines.length, 0, 'verified:', ...verificationLines(entry));
    }
    return `---\n${lines.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}

/** Appends an OKF log entry under today's date heading, adding the heading when it is new. */
export function appendLog(log: string, entry: Verification, text: string): string {
    const day = entry.at.slice(0, 10);
    const line = `**Verification** ${text} by ${entry.by} at ${entry.at}.`;
    const base = log.endsWith('\n') || !log ? log : `${log}\n`;
    const headings = [...base.matchAll(/^# (\d{4}-\d{2}-\d{2})\s*$/gm)];
    const lastDay = headings.at(-1)?.[1];
    return lastDay === day ? `${base}\n${line}\n` : `${base}\n# ${day}\n\n${line}\n`;
}

/** The bundle after a person verifies one concept; the input is not changed. */
export function verifyConcept(bundle: KnowledgeBundle, path: string, entry: Verification): KnowledgeBundle {
    const concept = bundle.concepts.find(item => item.path === path);
    const file = bundle.files[path];
    if (!concept || file === undefined) throw new Error(`No concept ${path} in this bundle`);
    return {
        ...bundle,
        files: {
            ...bundle.files,
            [path]: addVerification(file, entry),
            'log.md': appendLog(bundle.files['log.md'] ?? '', entry, `"${concept.title}" (${path})`),
        },
        concepts: bundle.concepts.map(item => item.path === path
            ? { ...item, verified: [...(item.verified ?? []), entry] }
            : item),
    };
}

/**
 * Keeps the reader's checks across a rebuild: a concept with the same path and
 * title in the new bundle gets the old verifications again. Anything whose text
 * moved or was renamed starts as a draft, since the check was of other content.
 */
export function carryVerifications(previous: KnowledgeBundle, next: KnowledgeBundle): KnowledgeBundle {
    let out = next;
    for (const old of previous.concepts) {
        if (!old.verified?.length) continue;
        const match = next.concepts.find(item => item.path === old.path && item.title === old.title);
        if (!match || isVerified(match)) continue;
        for (const entry of old.verified) out = verifyConcept(out, old.path, entry);
    }
    return out;
}

export interface ConceptIndexRequest {
    docId: string;
    pdfFingerprint: string;
    concepts: (Pick<ConceptRecord, 'path' | 'type' | 'title' | 'description' | 'page' | 'bbox'> & {
        markdown: string;
        verified: boolean;
    })[];
}

/**
 * The body of the RAG service's POST /concepts: every concept with its Markdown
 * file (the service searches the defining sentence and body too) and whether
 * the reader has verified it. The service replaces the PDF's concepts with these.
 */
export function conceptIndexRequest(bundle: KnowledgeBundle): ConceptIndexRequest {
    return {
        docId: bundle.documentId,
        pdfFingerprint: bundle.fingerprint,
        concepts: bundle.concepts.map(concept => ({
            path: concept.path,
            type: concept.type,
            title: concept.title,
            description: concept.description,
            page: concept.page,
            bbox: concept.bbox,
            markdown: bundle.files[concept.path] ?? '',
            verified: isVerified(concept),
        })),
    };
}
