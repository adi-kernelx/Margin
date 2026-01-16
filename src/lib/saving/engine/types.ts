export type EditorFile =
    | { kind: "cloud"; uid: string; fileId: string }
    | { kind: "local"; localFileId: string };

export type SaveReason =
    | "manual"
    | "autosave"
    | "flatten"
    | "save-as"
    | "export"
    | "recovery";

export type SaveState = "idle" | "dirty" | "saving" | "error";

export interface SaveJob {
    reason: SaveReason;
    payload: any; // We'll refine this generic annotation payload type later
    requestedAt: number;
}

export interface SaveAdapter {
    save(job: SaveJob): Promise<void>;
    flatten?(job: SaveJob): Promise<void>;
}
