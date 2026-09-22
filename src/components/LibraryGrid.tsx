import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronRight, FilePlus2, Folder, FolderPlus, HardDrive, Loader2, Pencil, Trash2 } from 'lucide-react';
import type { LibraryFile, LibraryFolder } from '@/types/library';
import { ROOT_FOLDER_ID } from '@/types/library';
import { libraryDB } from '@/lib/storage/library-db';
import { createLibraryPreview } from '@/lib/library-preview';
import { buildFolderBreadcrumbs } from '@/core/library/references';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface LibraryGridProps {
    onOpen: (file: LibraryFile) => void;
    onAddReferences: (folderId: string) => void;
}

function LibraryCard({ file, folders, onOpen, onReload }: {
    file: LibraryFile;
    folders: LibraryFolder[];
    onOpen: () => void;
    onReload: () => Promise<void>;
}) {
    const rename = async () => {
        const name = window.prompt('Rename this library entry:', file.name)?.trim();
        if (!name || name === file.name) return;
        await libraryDB.renameFile(file.id, name);
        await onReload();
    };
    const remove = async () => {
        if (!window.confirm(`Remove “${file.name}” from Margin?\n\nThe PDF on disk will not be deleted.`)) return;
        await libraryDB.deleteFile(file.id);
        await onReload();
    };

    return (
        <article className="group relative rounded-xl border border-line bg-surface-2 p-3 shadow-elev-1 transition-shadow hover:shadow-elev-3">
            <button type="button" onClick={onOpen} className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <div className="grid h-44 place-items-center overflow-hidden rounded-lg border border-line-soft bg-ground">
                    {file.coverThumbnail
                        ? <img src={file.coverThumbnail} alt="" className="h-full w-full object-contain" />
                        : <BookOpen size={42} className="text-text-muted" />}
                </div>
                <h3 className="mt-3 truncate font-semibold text-text" title={file.name}>{file.name}</h3>
                <div className="mt-1 flex justify-between text-xs text-text-muted">
                    <span>{file.pageCount ? `${file.pageCount} pages` : 'Preparing cover…'}</span>
                    <span className="inline-flex items-center gap-1"><HardDrive size={11} />{file.storageMode === 'handle' ? 'Reference' : 'Stored copy'}</span>
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
                <IconButton aria-label={`Rename ${file.name}`} onClick={() => void rename()}><Pencil size={14} /></IconButton>
                <IconButton aria-label={`Remove ${file.name}`} onClick={() => void remove()}><Trash2 size={14} /></IconButton>
            </div>
        </article>
    );
}

function FolderCard({ folder, onOpen, onRename, onDelete }: {
    folder: LibraryFolder;
    onOpen: () => void;
    onRename: () => void;
    onDelete: () => void;
}) {
    return (
        <article className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-3 shadow-elev-1">
            <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Folder size={24} /></span>
                <span className="truncate font-semibold text-text">{folder.name}</span>
            </button>
            <IconButton aria-label={`Rename folder ${folder.name}`} onClick={onRename}><Pencil size={14} /></IconButton>
            <IconButton aria-label={`Delete folder ${folder.name}`} onClick={onDelete}><Trash2 size={14} /></IconButton>
        </article>
    );
}

export function LibraryGrid({ onOpen, onAddReferences }: LibraryGridProps) {
    const [folders, setFolders] = useState<LibraryFolder[]>([]);
    const [childFolders, setChildFolders] = useState<LibraryFolder[]>([]);
    const [files, setFiles] = useState<LibraryFile[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID);
    const [loading, setLoading] = useState(true);
    const supportsReferences = 'showOpenFilePicker' in window;

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

    useEffect(() => {
        const timeout = window.setTimeout(() => { void loadFolder(); }, 0);
        return () => window.clearTimeout(timeout);
    }, [loadFolder]);

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
        if (!window.confirm(`Delete “${folder.name}” and remove every reference inside it?\n\nPDF files on disk will not be deleted.`)) return;
        await libraryDB.deleteFolderRecursive(folder.id);
        await loadFolder();
    };

    return (
        <main className="h-full overflow-y-auto bg-ground p-6 md:p-10" aria-label="Document library">
            <div className="mx-auto max-w-6xl">
                <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
                    <div><p className="text-sm font-semibold text-accent">LOCAL LIBRARY</p><h2 className="text-3xl font-bold text-text">Your documents</h2></div>
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
                            {index > 0 && <ChevronRight size={14} />}
                            <button className={folder.id === currentFolderId ? 'font-semibold text-text' : 'hover:text-accent'} onClick={() => setCurrentFolderId(folder.id)}>{folder.name}</button>
                        </span>
                    ))}
                </div>

                <p className="mb-6 rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-text-muted">
                    {supportsReferences
                        ? 'Margin stores references to your PDFs. The original files remain on disk and permission may be requested again after restarting the browser.'
                        : 'This browser cannot persist file references, so Margin stores local PDF copies as a compatibility fallback.'}
                </p>

                {loading ? (
                    <div className="grid h-64 place-items-center text-text-muted"><Loader2 className="animate-spin" /></div>
                ) : childFolders.length || files.length ? (
                    <>
                        {childFolders.length > 0 && (
                            <section className="mb-7" aria-label="Folders">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Folders</h3>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {childFolders.map(folder => <FolderCard key={folder.id} folder={folder} onOpen={() => setCurrentFolderId(folder.id)} onRename={() => void renameFolder(folder)} onDelete={() => void deleteFolder(folder)} />)}
                                </div>
                            </section>
                        )}
                        {files.length > 0 && (
                            <section aria-label="PDF references">
                                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">PDFs</h3>
                                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {files.map(file => <LibraryCard key={file.id} file={file} folders={folders} onOpen={() => onOpen(file)} onReload={loadFolder} />)}
                                </div>
                            </section>
                        )}
                    </>
                ) : (
                    <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
                        <div><Folder size={52} className="mx-auto mb-4 text-accent" /><h3 className="text-xl font-semibold">This folder is empty</h3><p className="mt-2 text-text-muted">Add PDF references here or create a folder for a course or project.</p></div>
                    </div>
                )}
            </div>
        </main>
    );
}
