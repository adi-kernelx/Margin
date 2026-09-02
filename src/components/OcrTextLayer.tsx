
import React, { useMemo } from 'react';
import type { OcrToken } from '@/lib/ocr/client-ocr';

import type { ToolMode } from '@/lib/store';

interface OcrTextLayerProps {
    tokens: OcrToken[];
    scale: number;
    width: number;  // Viewport width (px)
    height: number; // Viewport height (px)
    debug?: boolean;
    annotationMode?: ToolMode;
    nativeTextContent?: any;
    viewport?: any;
}

export const OcrTextLayer: React.FC<OcrTextLayerProps> = ({ tokens, scale: _scale, width, height, debug = false, annotationMode, nativeTextContent, viewport }) => {

    const isSelectMode = annotationMode === 'select';

    // Compute native bounding boxes for deduplication
    const nativeRects = useMemo(() => {
        if (!nativeTextContent?.items || !viewport) return [];
        const rects = [];
        for (const item of nativeTextContent.items) {
            if (!item.str || item.str.trim() === '') continue;
            // Native PDF points
            const tx = item.transform[4];
            const ty = item.transform[5];
            const w = item.width || 0;
            const h = Math.abs(item.transform[3]) || 12;

            // Convert to viewport pixel coordinates
            const [vx, vyBottom] = viewport.convertToViewportPoint(tx, ty);
            const [vxRight, vyTop] = viewport.convertToViewportPoint(tx + w, ty + h);

            const PADDING = 15; // 15 pixels padding for loose intersection

            rects.push({
                left: Math.min(vx, vxRight) - PADDING,
                right: Math.max(vx, vxRight) + PADDING,
                top: Math.min(vyTop, vyBottom) - PADDING,
                bottom: Math.max(vyTop, vyBottom) + PADDING
            });
        }
        return rects;
    }, [nativeTextContent, viewport]);

    // Memoize the spans to avoid re-calc on every render if props stable
    const textSpans = useMemo(() => {
        return tokens.map((token, i) => {
            const { x, y, w, h } = token.bbox;
            const fontSizeNorm = token.fontSizeNorm;

            // Convert normalized to pixels
            const left = x * width;
            const top = y * height;
            const boxWidth = w * width;
            const boxHeight = h * height;
            const right = left + boxWidth;
            const bottom = top + boxHeight;

            // Deduplication: skip rendering if OCR token overlaps with native text
            const isOverlapping = nativeRects.some(nr => {
                // Check AABB intersection
                return !(right < nr.left || left > nr.right || bottom < nr.top || top > nr.bottom);
            });

            if (isOverlapping) return null;
            const fontSize = fontSizeNorm * height;

            return (
                <span
                    key={i}
                    style={{
                        position: 'absolute',
                        left: `${left}px`,
                        top: `${top}px`,
                        width: `${boxWidth}px`,
                        height: `${boxHeight}px`,
                        fontSize: `${fontSize}px`,
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                        cursor: 'text',
                        transformOrigin: 'top left',

                        // INVISIBLE BUT SELECTABLE
                        color: 'transparent',
                        background: debug ? 'rgba(0, 0, 255, 0.1)' : 'transparent',
                        userSelect: 'text',
                        pointerEvents: 'auto'
                    }}
                    title={debug ? `${token.text} (${Math.round(token.confidence)}%)` : undefined}
                >
                    {token.text}
                </span>
            );
        });
    }, [tokens, width, height, debug, nativeRects]);

    return (
        <div
            className="ocr-text-layer"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${width}px`,
                height: `${height}px`,
                // If Select Mode -> Bring forward (zIndex 20 is typically above canvas but below some UI)
                // If Not Select -> Send backward (zIndex -1 or just below)
                zIndex: isSelectMode ? 20 : -1,
                // Only allow interactions in select mode
                pointerEvents: isSelectMode ? 'auto' : 'none',
                // Debug helper
                background: debug ? 'rgba(255, 0, 0, 0.05)' : 'transparent'
            }}
        >
            {textSpans}
        </div>
    );
};
