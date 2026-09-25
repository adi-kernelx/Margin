/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** "1" builds the static demo target (see src/lib/features.ts). */
    readonly VITE_DEMO?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
