
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
}

export const OcrTextLayer: React.FC<OcrTextLayerProps> = ({ tokens, scale: _scale, width, height, debug = false, annotationMode }) => {

    const isSelectMode = annotationMode === 'select';

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
    }, [tokens, width, height, debug]);

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
                zIndex: isSelectMode ? 10 : -1,
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
