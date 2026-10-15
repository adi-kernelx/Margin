import { describe, expect, it } from 'vitest';
import {
    addVerification, appendLog, carryVerifications, conceptIndexRequest, filterConcepts, groupConcepts, isVerified, verifyConcept,
    type ConceptRecord, type KnowledgeBundle,
} from './okf';

const FILE = `---
type: Definition
title: plane tree
generated:
  by: margin-okf/0.1
  at: '2026-10-14T00:00:00Z'
status: draft
margin:
  page: 2
---
> A plane tree is a subset t of U.

Body text.
`;

function concept(path: string, type: string, title: string, page: number): ConceptRecord {
    return {
        path, type, title, description: `${title} description`, page,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, method: 'detector', confidence: 0.9, proofPages: [], uses: [],
    };
}

const at = '2026-10-14T10:00:00Z';

describe('addVerification', () => {
    it('inserts a verified list before status and keeps the body', () => {
        const out = addVerification(FILE, { by: 'human:local', at });
        expect(out).toContain(`verified:\n- by: human:local\n  at: '${at}'\nstatus: draft`);
        expect(out.endsWith('> A plane tree is a subset t of U.\n\nBody text.\n')).toBe(true);
    });

    it('extends an existing list instead of adding a second key', () => {
        const once = addVerification(FILE, { by: 'human:local', at });
        const twice = addVerification(once, { by: 'human:other', at: '2026-10-15T09:00:00Z' });
        expect(twice.match(/^verified:/gm)).toHaveLength(1);
        expect(twice).toContain(`- by: human:local\n  at: '${at}'\n- by: human:other\n  at: '2026-10-15T09:00:00Z'\nstatus: draft`);
    });

    it('does not mistake the nested generated.at for a verified entry', () => {
        const out = addVerification(FILE, { by: 'human:local', at });
        expect(out).toContain("generated:\n  by: margin-okf/0.1\n  at: '2026-10-14T00:00:00Z'\nverified:");
    });

    it('refuses a file without frontmatter', () => {
        expect(() => addVerification('no frontmatter', { by: 'human:local', at })).toThrow();
    });
});

describe('appendLog', () => {
    it('adds a date heading only when the day changes', () => {
        const log = '# 2026-10-14\n\n**Creation** 3 draft concepts.\n';
        const same = appendLog(log, { by: 'human:local', at }, '"plane tree"');
        expect(same.match(/^# 2026-10-14/gm)).toHaveLength(1);
        expect(same).toContain('**Verification** "plane tree" by human:local at 2026-10-14T10:00:00Z.');
        const next = appendLog(same, { by: 'human:local', at: '2026-10-15T08:00:00Z' }, '"root"');
        expect(next).toContain('\n# 2026-10-15\n\n**Verification** "root"');
    });
});

describe('concept lists', () => {
    const concepts = [
        concept('results/theorem-3-4.md', 'Theorem', 'Theorem 3.4', 3),
        concept('definitions/plane-tree.md', 'Definition', 'plane tree', 2),
        concept('notation/f.md', 'Notation', 'F', 4),
        concept('definitions/bipartite.md', 'Definition', 'bipartite', 1),
    ];

    it('filters on every query word and sorts by page', () => {
        expect(filterConcepts(concepts, '').map(c => c.page)).toEqual([1, 2, 3, 4]);
        expect(filterConcepts(concepts, 'PLANE tree').map(c => c.title)).toEqual(['plane tree']);
        expect(filterConcepts(concepts, 'theorem').map(c => c.title)).toEqual(['Theorem 3.4']);
    });

    it('groups in reading order and drops empty groups', () => {
        const groups = groupConcepts(filterConcepts(concepts, ''));
        expect(groups.map(g => g.group)).toEqual(['Definitions', 'Notation', 'Results']);
        expect(groups[0].concepts.map(c => c.title)).toEqual(['bipartite', 'plane tree']);
    });
});

describe('verifyConcept', () => {
    const bundle: KnowledgeBundle = {
        documentId: 'doc', fingerprint: 'abc', fileName: 'toy.pdf', builtAt: at,
        summary: { concepts: 1, links: 0 },
        files: { 'definitions/plane-tree.md': FILE, 'log.md': '# 2026-10-14\n\n**Creation** 1 draft concept.\n' },
        concepts: [concept('definitions/plane-tree.md', 'Definition', 'plane tree', 2)],
    };

    it('updates the file, the record and the log without mutating the input', () => {
        const out = verifyConcept(bundle, 'definitions/plane-tree.md', { by: 'human:local', at });
        expect(isVerified(out.concepts[0])).toBe(true);
        expect(isVerified(bundle.concepts[0])).toBe(false);
        expect(out.files['definitions/plane-tree.md']).toContain('verified:\n- by: human:local');
        expect(bundle.files['definitions/plane-tree.md']).toBe(FILE);
        expect(out.files['log.md']).toContain('**Verification** "plane tree" (definitions/plane-tree.md)');
    });

    it('rejects an unknown path', () => {
        expect(() => verifyConcept(bundle, 'definitions/missing.md', { by: 'human:local', at })).toThrow();
    });
});

describe('carryVerifications', () => {
    const base: KnowledgeBundle = {
        documentId: 'doc', fingerprint: 'abc', fileName: 'toy.pdf', builtAt: at,
        summary: { concepts: 2, links: 0 },
        files: { 'definitions/plane-tree.md': FILE, 'definitions/root.md': FILE.replace('plane tree', 'root'), 'log.md': '' },
        concepts: [concept('definitions/plane-tree.md', 'Definition', 'plane tree', 2),
            concept('definitions/root.md', 'Definition', 'root', 3)],
    };

    it('re-applies checks to unchanged concepts only', () => {
        let previous = verifyConcept(base, 'definitions/plane-tree.md', { by: 'human:local', at });
        previous = verifyConcept(previous, 'definitions/root.md', { by: 'human:local', at });
        const renamed = { ...base, concepts: [base.concepts[0], { ...base.concepts[1], title: 'root vertex' }] };
        const out = carryVerifications(previous, renamed);
        expect(out.concepts.map(isVerified)).toEqual([true, false]);
        expect(out.files['definitions/plane-tree.md'].match(/^- by:/gm)).toHaveLength(1);
    });
});

describe('conceptIndexRequest', () => {
    it('sends each concept with its file and verification state', () => {
        const bundle: KnowledgeBundle = {
            documentId: 'doc', fingerprint: 'abc', fileName: 'toy.pdf', builtAt: at,
            summary: { concepts: 2, links: 0 },
            files: { 'definitions/plane-tree.md': FILE, 'log.md': '' },
            concepts: [concept('definitions/plane-tree.md', 'Definition', 'plane tree', 2),
                concept('definitions/root.md', 'Definition', 'root', 3)],
        };
        const request = conceptIndexRequest(verifyConcept(bundle, 'definitions/plane-tree.md', { by: 'human:local', at }));
        expect(request.docId).toBe('doc');
        expect(request.pdfFingerprint).toBe('abc');
        expect(request.concepts.map(c => [c.path, c.verified])).toEqual([
            ['definitions/plane-tree.md', true], ['definitions/root.md', false]]);
        expect(request.concepts[0].markdown).toContain('A plane tree is a subset');
        expect(request.concepts[1].markdown).toBe('');
        expect(request.concepts[0]).not.toHaveProperty('proofPages');
    });
});
