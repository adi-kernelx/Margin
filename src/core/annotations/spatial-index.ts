import type { Annotation, BoundingBox } from './models';

interface QuadtreeNode {
    bounds: BoundingBox;
    annotations: Annotation[];
    children: QuadtreeNode[] | null;
    divided: boolean;
}

/**
 * Quadtree spatial index for fast annotation hit testing
 * Provides O(log n) lookup instead of O(n)
 */
export class AnnotationQuadtree {
    private root: QuadtreeNode;
    private capacity = 4; // Max annotations per node before splitting
    private maxDepth = 8;

    constructor(bounds: BoundingBox) {
        this.root = {
            bounds,
            annotations: [],
            children: null,
            divided: false,
        };
    }

    /**
     * Insert annotation into the quadtree
     */
    insert(annotation: Annotation): boolean {
        const bounds = this.getAnnotationBounds(annotation);
        return this.insertNode(this.root, annotation, bounds, 0);
    }

    /**
     * Query annotations that intersect with given rectangle
     */
    query(rect: BoundingBox): Annotation[] {
        const found: Annotation[] = [];
        this.queryNode(this.root, rect, found);
        return found;
    }

    /**
     * Remove annotation from the quadtree
     */
    remove(annotationId: string): boolean {
        return this.removeNode(this.root, annotationId);
    }

    /**
     * Clear all annotations and rebuild tree
     */
    clear() {
        this.root.annotations = [];
        this.root.children = null;
        this.root.divided = false;
    }

    /**
     * Rebuild the entire tree with new annotations
     */
    rebuild(annotations: Annotation[]) {
        this.clear();
        for (const annotation of annotations) {
            this.insert(annotation);
        }
    }

    private insertNode(
        node: QuadtreeNode,
        annotation: Annotation,
        bounds: BoundingBox,
        depth: number
    ): boolean {
        // Check if bounds intersect with node
        if (!this.intersects(node.bounds, bounds)) {
            return false;
        }

        // If node has capacity and isn't divided, add here
        if (node.annotations.length < this.capacity && !node.divided) {
            node.annotations.push(annotation);
            return true;
        }

        // If max depth reached, force add here
        if (depth >= this.maxDepth) {
            node.annotations.push(annotation);
            return true;
        }

        // Otherwise, subdivide if needed
        if (!node.divided) {
            this.subdivide(node);
        }

        // A child may prune queries outside itself, so it must contain the whole annotation.
        if (node.children) {
            for (const child of node.children) {
                if (this.contains(child.bounds, bounds) && this.insertNode(child, annotation, bounds, depth + 1)) {
                    return true;
                }
            }
        }

        node.annotations.push(annotation);
        return true;
    }

    private queryNode(node: QuadtreeNode, rect: BoundingBox, found: Annotation[]) {
        // Check if query rect intersects node bounds
        if (!this.intersects(node.bounds, rect)) {
            return;
        }

        // Check annotations in this node
        for (const annotation of node.annotations) {
            const bounds = this.getAnnotationBounds(annotation);
            if (this.intersects(bounds, rect)) {
                found.push(annotation);
            }
        }

        // Recursively search children
        if (node.divided && node.children) {
            for (const child of node.children) {
                this.queryNode(child, rect, found);
            }
        }
    }

    private removeNode(node: QuadtreeNode, annotationId: string): boolean {
        // Try to remove from this node
        const index = node.annotations.findIndex(a => a.id === annotationId);
        if (index >= 0) {
            node.annotations.splice(index, 1);
            return true;
        }

        // Try to remove from children
        if (node.divided && node.children) {
            for (const child of node.children) {
                if (this.removeNode(child, annotationId)) {
                    return true;
                }
            }
        }

        return false;
    }

    private subdivide(node: QuadtreeNode) {
        const { x, y, width, height } = node.bounds;
        const w = width / 2;
        const h = height / 2;

        node.children = [
            // NorthWest
            { bounds: { x, y, width: w, height: h }, annotations: [], children: null, divided: false },
            // NorthEast
            { bounds: { x: x + w, y, width: w, height: h }, annotations: [], children: null, divided: false },
            // SouthWest
            { bounds: { x, y: y + h, width: w, height: h }, annotations: [], children: null, divided: false },
            // SouthEast
            { bounds: { x: x + w, y: y + h, width: w, height: h }, annotations: [], children: null, divided: false },
        ];

        node.divided = true;

        // Redistribute existing annotations to children
        const existing = [...node.annotations];
        node.annotations = [];

        for (const annotation of existing) {
            const bounds = this.getAnnotationBounds(annotation);
            let inserted = false;

            for (const child of node.children) {
                if (this.contains(child.bounds, bounds)) {
                    child.annotations.push(annotation);
                    inserted = true;
                    break;
                }
            }

            // If doesn't fit in any child, keep at this level
            if (!inserted) {
                node.annotations.push(annotation);
            }
        }
    }

    private getAnnotationBounds(annotation: Annotation): BoundingBox {
        switch (annotation.type) {
            case 'stroke': {
                const points = annotation.geometry.points;
                if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

                let minX = points[0].x;
                let minY = points[0].y;
                let maxX = points[0].x;
                let maxY = points[0].y;

                for (const point of points) {
                    minX = Math.min(minX, point.x);
                    minY = Math.min(minY, point.y);
                    maxX = Math.max(maxX, point.x);
                    maxY = Math.max(maxY, point.y);
                }

                return {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                };
            }

            case 'highlight': {
                if (annotation.geometry.mode === 'text-aware' && annotation.geometry.rects) {
                    const rects = annotation.geometry.rects;
                    if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

                    let minX = rects[0].x;
                    let minY = rects[0].y;
                    let maxX = rects[0].x + rects[0].width;
                    let maxY = rects[0].y + rects[0].height;

                    for (const rect of rects) {
                        minX = Math.min(minX, rect.x);
                        minY = Math.min(minY, rect.y);
                        maxX = Math.max(maxX, rect.x + rect.width);
                        maxY = Math.max(maxY, rect.y + rect.height);
                    }

                    return {
                        x: minX,
                        y: minY,
                        width: maxX - minX,
                        height: maxY - minY,
                    };
                } else if (annotation.geometry.path) {
                    // Treat as stroke
                    const points = annotation.geometry.path;
                    if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

                    let minX = points[0].x;
                    let minY = points[0].y;
                    let maxX = points[0].x;
                    let maxY = points[0].y;

                    for (const point of points) {
                        minX = Math.min(minX, point.x);
                        minY = Math.min(minY, point.y);
                        maxX = Math.max(maxX, point.x);
                        maxY = Math.max(maxY, point.y);
                    }

                    return {
                        x: minX,
                        y: minY,
                        width: maxX - minX,
                        height: maxY - minY,
                    };
                }
                return { x: 0, y: 0, width: 0, height: 0 };
            }

            case 'text':
                return annotation.geometry.boundingBox;

            case 'shape':
            case 'image':
            case 'math': {
                const bbox = annotation.geometry.boundingBox;
                const { transform } = annotation.geometry;

                if (!transform) {
                    return bbox;
                }

                // Calculate AABB from transform
                // Transform maps local (0,0, w, h) to global quad
                // We need global AABB of that quad
                const t = transform;
                const w = bbox.width;
                const h = bbox.height;

                // Corners in local space: (0,0), (w,0), (0,h), (w,h)
                // Transformed:
                // x' = a*x + c*y + e
                // y' = b*x + d*y + f

                const corners = [
                    { x: 0, y: 0 },
                    { x: w, y: 0 },
                    { x: 0, y: h },
                    { x: w, y: h }
                ];

                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;

                for (const p of corners) {
                    const tx = t.a * p.x + t.c * p.y + t.e;
                    const ty = t.b * p.x + t.d * p.y + t.f;
                    minX = Math.min(minX, tx);
                    maxX = Math.max(maxX, tx);
                    minY = Math.min(minY, ty);
                    maxY = Math.max(maxY, ty);
                }

                return {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                };
            }

            default:
                return { x: 0, y: 0, width: 0, height: 0 };
        }
    }

    private intersects(a: BoundingBox, b: BoundingBox): boolean {
        return !(
            a.x + a.width < b.x ||
            b.x + b.width < a.x ||
            a.y + a.height < b.y ||
            b.y + b.height < a.y
        );
    }

    private contains(outer: BoundingBox, inner: BoundingBox): boolean {
        return (
            inner.x >= outer.x &&
            inner.y >= outer.y &&
            inner.x + inner.width <= outer.x + outer.width &&
            inner.y + inner.height <= outer.y + outer.height
        );
    }
}
