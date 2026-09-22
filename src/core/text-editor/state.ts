export const MIN_TEXT_EDITOR_WIDTH = 120;
export const MIN_TEXT_EDITOR_HEIGHT = 64;

export interface TextEditorFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TextEditorBounds {
    width: number;
    height: number;
}

export interface TextEditorSession {
    mode: 'create' | 'edit';
    annotationId?: string;
    draft: string;
    frame: TextEditorFrame;
}

export interface PageFrame {
    x: number;
    y: number;
    width: number;
    height: number;
}

const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function createTextEditorSession(
    frame: TextEditorFrame,
    bounds: TextEditorBounds,
): TextEditorSession {
    return {
        mode: 'create',
        draft: '',
        frame: fitTextEditorFrame(frame, bounds),
    };
}

export function editTextEditorSession(
    annotationId: string,
    draft: string,
    frame: TextEditorFrame,
    bounds: TextEditorBounds,
): TextEditorSession {
    return {
        mode: 'edit',
        annotationId,
        draft,
        frame: fitTextEditorFrame(frame, bounds),
    };
}

export function setTextEditorDraft(
    session: TextEditorSession,
    draft: string,
): TextEditorSession {
    return { ...session, draft };
}

export function fitTextEditorFrame(
    frame: TextEditorFrame,
    bounds: TextEditorBounds,
): TextEditorFrame {
    const width = clamp(frame.width, Math.min(MIN_TEXT_EDITOR_WIDTH, bounds.width), bounds.width);
    const height = clamp(frame.height, Math.min(MIN_TEXT_EDITOR_HEIGHT, bounds.height), bounds.height);
    return {
        x: clamp(frame.x, 0, bounds.width - width),
        y: clamp(frame.y, 0, bounds.height - height),
        width,
        height,
    };
}

export function moveTextEditor(
    session: TextEditorSession,
    x: number,
    y: number,
    bounds: TextEditorBounds,
): TextEditorSession {
    return {
        ...session,
        frame: fitTextEditorFrame({ ...session.frame, x, y }, bounds),
    };
}

export function resizeTextEditor(
    session: TextEditorSession,
    width: number,
    height: number,
    bounds: TextEditorBounds,
): TextEditorSession {
    const available = {
        width: Math.max(0, bounds.width - session.frame.x),
        height: Math.max(0, bounds.height - session.frame.y),
    };
    return {
        ...session,
        frame: {
            ...session.frame,
            width: clamp(width, Math.min(MIN_TEXT_EDITOR_WIDTH, available.width), available.width),
            height: clamp(height, Math.min(MIN_TEXT_EDITOR_HEIGHT, available.height), available.height),
        },
    };
}

export function growTextEditorToContent(
    session: TextEditorSession,
    contentHeight: number,
    bounds: TextEditorBounds,
): TextEditorSession {
    if (contentHeight <= session.frame.height) return session;
    const resized = resizeTextEditor(session, session.frame.width, contentHeight, bounds);
    if (
        resized.frame.width === session.frame.width
        && resized.frame.height === session.frame.height
    ) return session;
    return resized;
}

export function canCommitTextEditor(session: TextEditorSession): boolean {
    return session.draft.trim().length > 0;
}

export function textEditorFrameToPageFrame(
    frame: TextEditorFrame,
    pageOrigin: { x: number; y: number },
    pageSize: TextEditorBounds,
): PageFrame {
    const rawX = frame.x - pageOrigin.x;
    const rawY = frame.y - pageOrigin.y;
    const x = clamp(rawX, 0, pageSize.width);
    const y = clamp(rawY, 0, pageSize.height);
    const right = clamp(rawX + frame.width, 0, pageSize.width);
    const bottom = clamp(rawY + frame.height, 0, pageSize.height);
    return {
        x: x / pageSize.width,
        y: y / pageSize.height,
        width: Math.max(0, right - x) / pageSize.width,
        height: Math.max(0, bottom - y) / pageSize.height,
    };
}
