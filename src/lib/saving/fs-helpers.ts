
export interface SaveFilePickerOptions {
    suggestedName?: string;
    startIn?: any;
    id?: string;
    excludeAcceptAllOption?: boolean;
    types?: {
        description: string;
        accept: Record<string, string[]>;
    }[];
}

export interface FileSystemFacade {
    showSavePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

export const browserFS: FileSystemFacade = {
    async showSavePicker(options) {
        if ('showSaveFilePicker' in window) {
            return (window as any).showSaveFilePicker(options);
        }
        throw new Error('FileSystemAccess API not supported');
    }
};

export async function hasWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
    try {
        const opts = { mode: 'readwrite' };
        // Check if we already have permission
        if ((await (handle as any).queryPermission(opts)) === 'granted') {
            return true;
        }
        // Request permission
        if ((await (handle as any).requestPermission(opts)) === 'granted') {
            return true;
        }
        return false;
    } catch (e) {
        console.error("Permission check failed", e);
        return false;
    }
}
