import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    BookOpen, ChevronRight, FilePlus2, FolderPlus,
    HardDrive, Loader2, Pencil, Search, Trash2,
} from 'lucide-react';
import type { LibraryFile, LibraryFolder } from '@/types/library';
import { ROOT_FOLDER_ID } from '@/types/library';
import { libraryDB } from '@/lib/storage/library-db';
import { createLibraryPreview } from '@/lib/library-preview';
import { buildFolderBreadcrumbs } from '@/core/library/references';
import { usePointerTilt } from '@/lib/ui/usePointerTilt';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { SegmentedControl } from './ui/SegmentedControl';
import { cn } from '@/lib/utils';

interface LibraryGridProps {
    onOpen: (file: LibraryFile) => void;
    onAddReferences: (folderId: string) => void;
}

type SortMode = 'recent' | 'name' | 'size';

const SORT_OPTIONS = [
    { value: 'recent', label: 'Recent' },
    { value: 'name',   label: 'Name'   },
    { value: 'size',   label: 'Size'   },
] as const;

function formatBytes(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function comparator(mode: SortMode): (a: LibraryFile, b: LibraryFile) => number {
    switch (mode) {
        case 'name': return (a, b) => a.name.localeCompare(b.name);
        case 'size': return (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
        default:     return (a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt);
    }
}

/** One document card at elevation 1, wrapped in stacked-paper and pointer tilt. */
function DocumentCard({ file, folders, onOpen, onReload }: {
    file: LibraryFile;
    folders: LibraryFolder[];
    onOpen: () => void;
    onReload: () => Promise<void>;
}) {
    const tilt = usePointerTilt<HTMLDivElement>();
    const rename = async () => {
        const name = window.prompt('Rename this library entry:', file.name)?.trim();
        if (!name || name === file.name) return;
        await libraryDB.renameFile(file.id, name);
        await onReload();
    };
    const remove = async () => {
        if (!window.confirm(`Remove "${file.name}" from Margin?\n\nThe PDF on disk will not be deleted.`)) return;
        await libraryDB.deleteFile(file.id);
        await onReload();
    };

    return (
        // depth-stack draws two sheets behind the front card so the whole
        // thing reads as a physical stack of paper on a desk. depth-tilt on
        // the front card responds to pointer position via usePointerTilt.
        <div className="depth-stack relative rounded-xl">
            <article
                ref={tilt.ref}
                onPointerMove={tilt.onPointerMove}
                onPointerEnter={tilt.onPointerEnter}
                onPointerLeave={tilt.onPointerLeave}
                onBlur={tilt.onBlur}
                className={cn(
                    'depth-tilt group relative rounded-xl border border-line bg-surface-2 p-3',
                    'shadow-elev-2 transition-shadow duration-surface hover:shadow-elev-3',
                    // Raise the whole card slightly on hover so the drop
                    // shadow reads as lift, not just a static elevation swap.
                    'hover:-translate-y-[1px]',
                )}
            >
                <button
                    type="button"
                    onClick={onOpen}
                    className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                    <div className="relative grid h-44 place-items-center overflow-hidden rounded-lg border border-line-soft bg-ground">
                        {file.coverThumbnail
                            ? <img src={file.coverThumbnail} alt="" className="h-full w-full object-contain" />
                            : <BookOpen size={42} className="text-text-muted" aria-hidden />}
                        {file.status === 'importing' && (
                            <div className="absolute inset-0 grid place-items-center bg-surface-2/60">
                                <Loader2 size={18} className="animate-spin text-accent" />
                            </div>
                        )}
                    </div>
                    <h3 className="mt-3 truncate font-semibold text-text" title={file.name}>{file.name}</h3>
                    <div className="mt-1 flex items-center justify-between text-xs text-text-muted">
                        <span>{file.pageCount ? `${file.pageCount} pages` : 'Preparing cover…'}</span>
                        <span className="inline-flex items-center gap-1">
                            <HardDrive size={11} aria-hidden />
                            {file.storageMode === 'handle' ? 'Reference' : 'Copy'}
                        </span>
                    </div>
                </button>
                <div className="mt-3 flex items-center gap-1 border-t border-line-soft pt-2">
                    <select
                        aria-label={`Move ${file.name} to folder`}
                        value={file.parentFolderId}
                        onChange={async event => { await libraryDB.moveFile(file.id, event.target.value); await onReload(); }}
                        className="min-w-0 flex-1 rounded border border-line bg-surface-1 px-2 py-1 text-xs text-text"
                    >
                        {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                    <IconButton size="sm" aria-label={`Rename ${file.name}`} onClick={() => void rename()}><Pencil size={14} /></IconButton>
                    <IconButton size="sm" aria-label={`Remove ${file.name}`} onClick={() => void remove()}><Trash2 size={14} /></IconButton>
                </div>
            </article>
        </div>
    );
}

/**
 * Larger card for the Continue Reading shelf: same tilt, but the cover fills
 * more of the surface, and last-read position appears alongside the page
 * count. Rendered only when the user has at least one recently-opened doc.
 */
function ReadingShelfCard({ file, onOpen }: { file: LibraryFile; onOpen: () => void }) {
    const tilt = usePointerTilt<HTMLButtonElement>();
    const progress = file.pageCount && file.lastReadPage
        ? Math.min(1, file.lastReadPage / file.pageCount)
        : 0;
    return (
        <button
            type="button"
            onClick={onOpen}
            ref={tilt.ref}
            onPointerMove={tilt.onPointerMove}
            onPointerEnter={tilt.onPointerEnter}
            onPointerLeave={tilt.onPointerLeave}
            onBlur={tilt.onBlur}
            className={cn(
                'depth-tilt group flex min-h-[13rem] w-full items-center gap-4 rounded-xl border border-line bg-surface-2 p-4 text-left',
                'shadow-elev-2 transition-shadow duration-surface hover:-translate-y-[1px] hover:shadow-elev-3',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
            )}
        >
            <div className="grid h-40 w-32 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-soft bg-ground">
                {file.coverThumbnail
                    ? <img src={file.coverThumbnail} alt="" className="h-full w-full object-contain" />
                    : <BookOpen size={36} className="text-text-muted" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs uppercase tracking-wide text-text-muted">Continue reading</p>
                <h3 className="truncate text-lg font-semibold text-text" title={file.name}>{file.name}</h3>
                <p className="mt-1 text-sm text-text-muted">
                    Page {file.lastReadPage ?? 1} of {file.pageCount ?? '?'}
                </p>
                {progress > 0 && (
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
                        <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                )}
            </div>
        </button>
    );
}

/**
 * Isometric folder card. Three token-coloured divs under a shared CSS
 * transform make a stack of folder + tab + shadow; no PNGs, no SVGs, the
 * whole shape scales and themes automatically.
 */
function FolderCard({ folder, count, onOpen, onRename, onDelete }: {
    folder: LibraryFolder;
    count: number;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
}) {
    return (
        <article className="depth-pressable flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-3">
            <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span
                    className="iso-scene grid h-12 w-12 shrink-0 place-items-center"
                    aria-hidden
                >
                    <span className="relative block h-8 w-10">
                        {/* Back sheet peeks above the folder body. */}
                        <span className="absolute left-1 top-0 h-2 w-6 rounded-sm bg-accent-soft" />
                        <span className="absolute inset-x-0 bottom-0 h-6 rounded-md bg-accent shadow-elev-1" />
                    </span>
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-text">{folder.name}</span>
                    <span className="text-xs text-text-muted">{count} {count === 1 ? 'item' : 'items'}</span>
                </span>
            </button>
            <IconButton size="sm" aria-label={`Rename folder ${folder.name}`} onClick={onRename}><Pencil size={14} /></IconButton>
            <IconButton size="sm" aria-label={`Delete folder ${folder.name}`} onClick={onDelete}><Trash2 size={14} /></IconButton>
        </article>
    );
}

/**
 * Empty-state artwork: a CSS-only isometric stack of pages with a pen.
 * Themed via tokens, so light and dark modes are handled automatically.
 */
function EmptyStateArt() {
    return (
        <div className="iso-scene mx-auto mb-6 h-32 w-40" aria-hidden>
            <div className="relative h-24 w-24 mx-auto">
                <span className="absolute inset-0 rounded-md bg-surface-3 shadow-elev-3" />
                <span className="absolute inset-1 translate-x-1 translate-y-1 rounded-md bg-surface-2 shadow-elev-2" />
                <span className="absolute inset-2 translate-x-2 translate-y-2 rounded-md bg-surface-1 border border-line-soft" />
                <span className="absolute right-[-4px] top-[6px] h-10 w-1 rotate-[35deg] rounded-full bg-accent" />
            </div>
        </div>
    );
}

export function LibraryGrid({ onOpen, onAddReferences }: LibraryGridProps) {
    const [folders, setFolders] = useState<LibraryFolder[]>([]);
    const [childFolders, setChildFolders] = useState<LibraryFolder[]>([]);
    const [files, setFiles] = useState<LibraryFile[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID);
    const [loading, setLoading] = useState(true);
    const [sortMode, setSortMode] = useState<SortMode>('recent');
    const [query, setQuery] = useState('');
    const [isDropping, setIsDropping] = useState(false);
    const [importing, setImporting] = useState(false);
    const supportsReferences = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
    // useDeferredValue keeps a large library responsive under typed filters:
    // the input updates immediately, filtering runs at low priority.
    const deferredQuery = useDeferredValue(query);

    const loadFolder = useCallback(async () => {
        setLoading(true);
        await libraryDB.ensureRoot();
        const [allFolders, children, folderFiles] = await Promise.all([
            libraryDB.listAllFolders(),
            libraryDB.listChildFolders(currentFolderId),
            libraryDB.listFiles(currentFolderId),
        ]);
        setFolders(allFolders.sort((a, b) => a.name.localeCompare(b.name)));
        setChildFolders(children);
        setFiles(folderFiles);
        setLoading(false);
    }, [currentFolderId]);

    // Fetch a full list of files for the reading shelf, which is not scoped
    // to the current folder — it surfaces the most recently opened items
    // regardless of where they live.
    const [recent, setRecent] = useState<LibraryFile[]>([]);
    useEffect(() => {
        void libraryDB.listAllFiles().then(all => setRecent(all
            .filter(entry => entry.lastOpenedAt)
            .slice(0, 3)));
    }, [loading]);

    useEffect(() => {
        const timeout = window.setTimeout(() => { void loadFolder(); }, 0);
        return () => window.clearTimeout(timeout);
    }, [loadFolder]);

    // Fill in missing covers on first appearance. Sequential to avoid a
    // burst of parallel PDF.js render tasks that would compete for the GPU.
    useEffect(() => {
        let cancelled = false;
        const prepareMissingCovers = async () => {
            for (const entry of files.filter(item => !item.coverThumbnail || !item.pageCount)) {
                const access = await libraryDB.openFile(entry.id, false);
                if (access.status !== 'ready' || cancelled) continue;
                try {
                    const metadata = await createLibraryPreview(access.file);
                    await libraryDB.updateFileMetadata(entry.id, metadata);
                    if (!cancelled) setFiles(current => current.map(item => item.id === entry.id ? { ...item, ...metadata } : item));
                } catch (error) {
                    console.error(`Could not render cover for ${entry.name}:`, error);
                }
            }
        };
        void prepareMissingCovers();
        return () => { cancelled = true; };
    }, [files]);

    const breadcrumbs = useMemo(() => buildFolderBreadcrumbs(folders, currentFolderId), [folders, currentFolderId]);

    // Count of items per folder for the folder card. Cheap enough: the
    // library normally holds tens of folders, not thousands.
    const folderCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const folder of folders) counts.set(folder.id, 0);
        for (const file of files) counts.set(file.parentFolderId, (counts.get(file.parentFolderId) ?? 0) + 1);
        return counts;
    }, [folders, files]);

    const filteredFiles = useMemo(() => {
        const trimmed = deferredQuery.trim().toLowerCase();
        const filtered = trimmed
            ? files.filter(file => file.name.toLowerCase().includes(trimmed))
            : files;
        return [...filtered].sort(comparator(sortMode));
    }, [files, deferredQuery, sortMode]);

    const createFolder = async () => {
        const name = window.prompt('Folder name:')?.trim();
        if (!name) return;
        await libraryDB.createFolder(name, currentFolderId);
        await loadFolder();
    };
    const renameFolder = async (folder: LibraryFolder) => {
        const name = window.prompt('Rename folder:', folder.name)?.trim();
        if (!name || name === folder.name) return;
        await libraryDB.renameFolder(folder.id, name);
        await loadFolder();
    };
    const deleteFolder = async (folder: LibraryFolder) => {
        if (!window.confirm(`Delete "${folder.name}" and remove every reference inside it?\n\nPDF files on disk will not be deleted.`)) return;
        await libraryDB.deleteFolderRecursive(folder.id);
        await loadFolder();
    };

    // Drag-drop import from the OS. Blob copies are always safe; showing a
    // "reference" hint would be misleading because dragged files don't carry
    // a file handle on the drop event.
    const dropRef = useRef<HTMLDivElement>(null);
    const onDragOver = (event: React.DragEvent) => {
        if (Array.from(event.dataTransfer.items).some(item => item.kind === 'file')) {
            event.preventDefault();
            setIsDropping(true);
        }
    };
    const onDragLeave = (event: React.DragEvent) => {
        if (event.currentTarget === event.target) setIsDropping(false);
    };
    const onDrop = async (event: React.DragEvent) => {
        event.preventDefault();
        setIsDropping(false);
        const pdfs = Array.from(event.dataTransfer.files).filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
        if (!pdfs.length) return;
        setImporting(true);
        try {
            for (const pdf of pdfs) await libraryDB.importFile(pdf, currentFolderId);
            await loadFolder();
        } finally {
            setImporting(false);
        }
    };

    return (
        <main
            ref={dropRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={event => void onDrop(event)}
            className="relative h-full overflow-y-auto bg-ground p-6 md:p-10"
            aria-label="Document library"
        >
            <div className="mx-auto max-w-6xl">
                <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold text-accent">LOCAL LIBRARY</p>
                        <h2 className="text-3xl font-bold text-text">Your documents</h2>
                    </div>
                    <div className="flex gap-2">
                        <Button leadingIcon={<FolderPlus size={16} />} onClick={() => void createFolder()}>New folder</Button>
                        <Button variant="primary" leadingIcon={<FilePlus2 size={16} />} onClick={() => onAddReferences(currentFolderId)}>
                            {supportsReferences ? 'Add PDF references' : 'Import PDF copies'}
                        </Button>
                    </div>
                </header>

                <div className="mb-5 flex flex-wrap items-center gap-1 text-sm text-text-muted" aria-label="Folder path">
                    {breadcrumbs.map((folder, index) => (
                        <span key={folder.id} className="inline-flex items-center gap-1">
                            {index > 0 && <ChevronRight size={14} aria-hidden />}
                            <button
                                type="button"
                                className={cn(
                                    folder.id === currentFolderId
                                        ? 'font-semibold text-text'
                                        : 'hover:text-accent',
                                )}
                                onClick={() => setCurrentFolderId(folder.id)}
                            >
                                {folder.name}
                            </button>
                        </span>
                    ))}
                </div>

                {recent.length > 0 && currentFolderId === ROOT_FOLDER_ID && (
                    <section className="mb-8" aria-label="Continue reading">
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
                            Continue reading
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {recent.map(entry => <ReadingShelfCard key={entry.id} file={entry} onOpen={() => onOpen(entry)} />)}
                        </div>
                    </section>
                )}

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="relative w-full max-w-xs">
                        <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-text-muted" aria-hidden />
                        <input
                            type="search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="Filter this folder…"
                            aria-label="Filter documents in this folder"
                            className={cn(
                                'w-full rounded-md border border-line bg-surface-1 py-1.5 pl-7 pr-2 text-sm text-text',
                                'placeholder:text-text-muted focus-visible:border-accent',
                            )}
                        />
                    </div>
                    <SegmentedControl
                        label="Sort"
                        value={sortMode}
                        options={SORT_OPTIONS}
                        onChange={(next) => setSortMode(next as SortMode)}
                    />
                </div>

                {loading ? (
                    <div className="grid h-64 place-items-center text-text-muted"><Loader2 className="animate-spin" /></div>
                ) : childFolders.length || files.length ? (
                    <>
                        {childFolders.length > 0 && (
                            <section className="mb-7" aria-label="Folders">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Folders</h3>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {childFolders.map(folder => (
                                        <FolderCard
                                            key={folder.id}
                                            folder={folder}
                                            count={folderCounts.get(folder.id) ?? 0}
                                            onOpen={() => setCurrentFolderId(folder.id)}
                                            onRename={() => void renameFolder(folder)}
                                            onDelete={() => void deleteFolder(folder)}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                        {filteredFiles.length > 0 ? (
                            <section aria-label="PDF references">
                                <div className="mb-3 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">PDFs</h3>
                                    <span className="text-xs text-text-muted">
                                        {filteredFiles.length} of {files.length}
                                        {files.length > 0 && ` · ${formatBytes(files.reduce((n, f) => n + (f.sizeBytes ?? 0), 0))}`}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {filteredFiles.map(file => (
                                        <DocumentCard
                                            key={file.id}
                                            file={file}
                                            folders={folders}
                                            onOpen={() => onOpen(file)}
                                            onReload={loadFolder}
                                        />
                                    ))}
                                </div>
                            </section>
                        ) : query ? (
                            <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-line bg-surface-1 p-8 text-center">
                                <p className="text-sm text-text-muted">No PDFs match "{query}" in this folder.</p>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
                        <div>
                            <EmptyStateArt />
                            <h3 className="text-xl font-semibold text-text">This folder is empty</h3>
                            <p className="mt-2 text-text-muted">Drop PDFs to add copies, or create a folder for a course or project.</p>
                            <div className="mt-4 flex justify-center gap-2">
                                <Button leadingIcon={<FolderPlus size={16} />} onClick={() => void createFolder()}>New folder</Button>
                                <Button variant="primary" leadingIcon={<FilePlus2 size={16} />} onClick={() => onAddReferences(currentFolderId)}>
                                    {supportsReferences ? 'Add PDF references' : 'Import PDF copies'}
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Drop overlay. Rendered above everything else; token-driven so
                it matches both themes automatically. */}
            {(isDropping || importing) && (
                <div
                    className={cn(
                        'pointer-events-none absolute inset-0 z-panel grid place-items-center',
                        'bg-accent-soft/70 backdrop-blur-sm',
                    )}
                    aria-hidden={!isDropping}
                >
                    <div className="rounded-2xl border-2 border-dashed border-accent bg-surface-2 px-8 py-6 text-center shadow-elev-4">
                        {importing
                            ? <p className="flex items-center gap-2 text-accent"><Loader2 size={18} className="animate-spin" /> Adding to library…</p>
                            : <p className="text-accent">Drop PDFs to import into this folder</p>}
                    </div>
                </div>
            )}
        </main>
    );
}
