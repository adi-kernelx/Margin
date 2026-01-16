import { FileSaveController } from "./file-save-controller";
import type { EditorFile, SaveAdapter, SaveReason, SaveState } from "./types";

class SaveManagerImpl {
    private controllers = new Map<string, FileSaveController>();
    private payloadGetters = new Map<string, () => any>();

    // Helper to stick key
    private getFileKey(file: EditorFile): string {
        return file.kind === 'cloud' ? `cloud:${file.uid}:${file.fileId}` : `local:${file.localFileId}`;
    }

    registerFile(
        file: EditorFile,
        adapter: SaveAdapter,
        getPayload: () => any, // Needed for autosave to pull fresh state
        onStateChange?: (state: SaveState) => void
    ) {
        const key = this.getFileKey(file);
        if (this.controllers.has(key)) return;

        const controller = new FileSaveController(adapter, onStateChange);
        this.controllers.set(key, controller);
        this.payloadGetters.set(key, getPayload);
    }

    unregisterFile(file: EditorFile) {
        const key = this.getFileKey(file);
        const controller = this.controllers.get(key);
        if (controller) {
            controller.disableAutosave();
            this.controllers.delete(key);
            this.payloadGetters.delete(key);
        }
    }

    markDirty(file: EditorFile) {
        const key = this.getFileKey(file);
        const controller = this.controllers.get(key);
        const getter = this.payloadGetters.get(key);

        if (controller && getter) {
            controller.markDirty(getter());
        }
    }

    async saveNow(file: EditorFile, reason: SaveReason) {
        const key = this.getFileKey(file);
        const controller = this.controllers.get(key);
        const getter = this.payloadGetters.get(key);

        if (controller && getter) {
            await controller.enqueueSave(reason, getter());
        }
    }

    enableAutosave(file: EditorFile, intervalSec: number) {
        const key = this.getFileKey(file);
        const controller = this.controllers.get(key);
        const getter = this.payloadGetters.get(key);

        if (controller && getter) {
            controller.enableAutosave(intervalSec, getter);
        }
    }

    disableAutosave(file: EditorFile) {
        const key = this.getFileKey(file);
        const controller = this.controllers.get(key);
        if (controller) {
            controller.disableAutosave();
        }
    }

    saveAll(reason: SaveReason) {
        // Trigger save for all registered files
        for (const [key, controller] of this.controllers) {
            const getter = this.payloadGetters.get(key);
            if (getter) {
                controller.enqueueSave(reason, getter());
            }
        }
    }
}

export const SaveManager = new SaveManagerImpl();
