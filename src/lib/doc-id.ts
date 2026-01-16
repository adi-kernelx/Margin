export async function computeStableId(handle: FileSystemFileHandle): Promise<string> {
    try {
        const file = await handle.getFile();
        // Format: name:size:lastModified
        const id = `handle:${file.name}:${file.size}:${file.lastModified}`;
        console.log('[DocID] Computed stableId for handle:', file.name, '->', id);
        return id;
    } catch (e) {
        console.error("Failed to compute stable ID from handle", e);
        return `error-${Date.now()}`;
    }
}

export async function computeStableIdForFile(file: File): Promise<string> {
    // For direct file inputs, we also use name:size:lastModified
    // Ideally we would hash content, but reading large PDFs for hash on every open is slow.
    // Given the constraints and user "name:size:lastModified" suggestion for handle,
    // we stick to this for consistency unless collision is high risk.
    return `file:${file.name}:${file.size}:${file.lastModified}`;
}

export async function computeContentHashId(file: File): Promise<string> {
    // If we need stricter content hashing (optional fallback)
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
