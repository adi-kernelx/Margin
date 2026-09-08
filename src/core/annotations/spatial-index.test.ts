import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { AnnotationQuadtree } from './spatial-index';
import { strokeCovering, makeShape, idsOf, nextId } from './test-factories';
import type { BoundingBox } from './models';

const PAGE: BoundingBox = { x: 0, y: 0, width: 1, height: 1 };

/** Brute-force ground truth: the answer a quadtree must reproduce. */
function intersects(a: BoundingBox, b: BoundingBox): boolean {
    return !(
        a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y
    );
}

const arbBox = fc
    .record({
        x: fc.double({ min: 0, max: 0.9, noNaN: true }),
        y: fc.double({ min: 0, max: 0.9, noNaN: true }),
        width: fc.double({ min: 0, max: 0.1, noNaN: true }),
        height: fc.double({ min: 0, max: 0.1, noNaN: true }),
    })
    .map((b) => b as BoundingBox);

describe('AnnotationQuadtree', () => {
    it('finds an annotation that overlaps the query rect', () => {
        const tree = new AnnotationQuadtree(PAGE);
        const target = strokeCovering({ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, 'target');
        tree.insert(target);

        expect(idsOf(tree.query({ x: 0.15, y: 0.15, width: 0.01, height: 0.01 }))).toEqual(['target']);
    });

    it('excludes an annotation that misses the query rect', () => {
        const tree = new AnnotationQuadtree(PAGE);
        tree.insert(strokeCovering({ x: 0.1, y: 0.1, width: 0.05, height: 0.05 }, 'far'));

        expect(tree.query({ x: 0.8, y: 0.8, width: 0.05, height: 0.05 })).toEqual([]);
    });

    it('still finds annotations after subdividing past node capacity', () => {
        // Capacity is 4, so 40 annotations forces several levels of split. The
        // point is that redistribution must not drop anything.
        const tree = new AnnotationQuadtree(PAGE);
        const ids: string[] = [];
        for (let i = 0; i < 40; i++) {
            const id = `n-${i}`;
            ids.push(id);
            tree.insert(strokeCovering({ x: (i % 10) * 0.09, y: Math.floor(i / 10) * 0.09, width: 0.01, height: 0.01 }, id));
        }

        expect(idsOf(tree.query(PAGE)).length).toBe(ids.length);
    });

    it('removes an annotation from a subdivided tree', () => {
        const tree = new AnnotationQuadtree(PAGE);
        for (let i = 0; i < 20; i++) {
            tree.insert(strokeCovering({ x: i * 0.04, y: i * 0.04, width: 0.01, height: 0.01 }, `n-${i}`));
        }

        expect(tree.remove('n-13')).toBe(true);
        expect(idsOf(tree.query(PAGE))).not.toContain('n-13');
        expect(tree.remove('n-13')).toBe(false);
    });

    it('clear() empties the tree', () => {
        const tree = new AnnotationQuadtree(PAGE);
        tree.insert(strokeCovering({ x: 0.2, y: 0.2, width: 0.1, height: 0.1 }));
        tree.clear();

        expect(tree.query(PAGE)).toEqual([]);
    });

    it('rebuild() replaces the contents wholesale', () => {
        const tree = new AnnotationQuadtree(PAGE);
        tree.insert(strokeCovering({ x: 0.2, y: 0.2, width: 0.1, height: 0.1 }, 'old'));
        tree.rebuild([makeShape({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, 'new')]);

        expect(idsOf(tree.query(PAGE))).toEqual(['new']);
    });

    // The property that matters: an index is only worth having if it returns
    // exactly what a linear scan would. Anything the quadtree drops here is a
    // hit-test the user would experience as "my annotation isn't clickable".
    it('agrees with a linear scan for arbitrary boxes and queries', () => {
        fc.assert(
            fc.property(fc.array(arbBox, { minLength: 1, maxLength: 60 }), arbBox, (boxes, queryRect) => {
                const annotations = boxes.map((b) => strokeCovering(b, nextId('p')));

                const tree = new AnnotationQuadtree(PAGE);
                for (const a of annotations) tree.insert(a);

                const expected = annotations
                    .filter((a) => {
                        const pts = a.geometry.points;
                        const box: BoundingBox = {
                            x: pts[0].x,
                            y: pts[0].y,
                            width: pts[1].x - pts[0].x,
                            height: pts[1].y - pts[0].y,
                        };
                        return intersects(box, queryRect);
                    })
                    .map((a) => a.id)
                    .sort();

                expect(idsOf(tree.query(queryRect))).toEqual(expected);
            }),
            { numRuns: 200 },
        );
    });
});
