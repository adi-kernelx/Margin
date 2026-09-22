export interface FileIdentityInput {
    name: string;
    size: number;
    lastModified: number;
}

export interface FolderNode {
    id: string;
    name: string;
    parentFolderId: string | null;
}

/** Stable enough to recognize the same picker file without reading its full contents. */
export function createFileIdentity(file: FileIdentityInput): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

export function buildFolderBreadcrumbs<T extends FolderNode>(folders: T[], currentId: string): T[] {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    const result: T[] = [];
    const visited = new Set<string>();
    let current = byId.get(currentId);
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        result.unshift(current);
        current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined;
    }
    return result;
}

export function normalizeLibraryName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
}
