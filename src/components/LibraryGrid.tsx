import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, FilePlus2, Loader2 } from 'lucide-react';
import type { LibraryFile } from '@/types/library';
import { libraryDB } from '@/lib/storage/library-db';
import { createLibraryPreview } from '@/lib/library-preview';
import { Button } from './ui/Button';

interface LibraryGridProps {
    onOpen: (file: LibraryFile) => void;
}
function LibraryCard({ file, onOpen }: { file: LibraryFile; onOpen: () => void }) {
    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        event.currentTarget.style.setProperty('--card-rx', `${(-y * 8).toFixed(2)}deg`);
        event.currentTarget.style.setProperty('--card-ry', `${(x * 8).toFixed(2)}deg`);
    };
    const resetTilt = (element: HTMLButtonElement) => {
        element.style.setProperty('--card-rx', '0deg');
        element.style.setProperty('--card-ry', '0deg');
    };

    return (
        <button
            type="button"
            onClick={onOpen}
            onPointerMove={handlePointerMove}
            onPointerLeave={event => resetTilt(event.currentTarget)}
            onBlur={event => resetTilt(event.currentTarget)}
            className="group relative rounded-xl border border-line bg-surface-2 p-3 text-left shadow-elev-1 transition-[transform,box-shadow] duration-200 hover:shadow-elev-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            style={{ transform: 'perspective(900px) rotateX(var(--card-rx, 0deg)) rotateY(var(--card-ry, 0deg))' }}
        >
            <div className="absolute inset-x-4 -bottom-1 -z-10 h-3 rounded-b-xl border border-line-soft bg-surface-3" aria-hidden="true" />
            <div className="grid h-52 place-items-center overflow-hidden rounded-lg border border-line-soft bg-ground">
                {file.coverThumbnail
                    ? <img src={file.coverThumbnail} alt="" className="h-full w-full object-contain" />
                    : <BookOpen size={42} className="text-text-muted" />}
            </div>
            <h3 className="mt-3 truncate font-semibold text-text" title={file.name}>{file.name}</h3>
            <div className="mt-1 flex justify-between text-xs text-text-muted">
                <span>{file.pageCount ? `${file.pageCount} pages` : 'Preparing cover…'}</span>
                <span>{file.lastReadPage ? `Page ${file.lastReadPage}` : 'Unread'}</span>
            </div>
        </button>
    );
}

export function LibraryGrid({ onOpen }: LibraryGridProps) {
    const [files, setFiles] = useState<LibraryFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const loadFiles = useCallback(async () => {
        setFiles(await libraryDB.listAllFiles());
        setLoading(false);
    }, []);

    useEffect(() => { void loadFiles(); }, [loadFiles]);

    useEffect(() => {
        let cancelled = false;
        const prepareMissingCovers = async () => {
            for (const file of files.filter(item => !item.coverThumbnail || !item.pageCount)) {
                const blob = await libraryDB.getFileBlob(file.id);
                if (!blob || cancelled) continue;
                try {
                    const metadata = await createLibraryPreview(blob);
                    await libraryDB.updateFileMetadata(file.id, metadata);
                    if (!cancelled) setFiles(current => current.map(item => item.id === file.id ? { ...item, ...metadata } : item));
                } catch (error) {
                    console.error(`Could not render cover for ${file.name}:`, error);
                }
            }
        };
        void prepareMissingCovers();
        return () => { cancelled = true; };
    }, [files]);

    const importFiles = async (selected: FileList | null) => {
        if (!selected?.length) return;
        setImporting(true);
        try {
            await libraryDB.ensureRoot();
            for (const file of Array.from(selected)) await libraryDB.importFile(file, 'root');
            await loadFiles();
        } finally {
            setImporting(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-ground p-6 md:p-10" aria-label="Document library">
            <div className="mx-auto max-w-6xl">
                <header className="mb-6 flex items-end justify-between gap-4">
                    <div><p className="text-sm font-semibold text-accent">LOCAL LIBRARY</p><h2 className="text-3xl font-bold text-text">Your documents</h2></div>
                    <Button leadingIcon={importing ? <Loader2 size={16} className="animate-spin" /> : <FilePlus2 size={16} />} onClick={() => inputRef.current?.click()} disabled={importing}>Import PDFs</Button>
                    <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={event => void importFiles(event.target.files)} />
                </header>
                {loading ? (
                    <div className="grid h-64 place-items-center text-text-muted"><Loader2 className="animate-spin" /></div>
                ) : files.length ? (
                    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                        {files.map(file => <LibraryCard key={file.id} file={file} onOpen={() => onOpen(file)} />)}
                    </div>
                ) : (
                    <div className="grid min-h-96 place-items-center rounded-2xl border border-dashed border-line bg-surface-1 p-10 text-center">
                        <div><BookOpen size={52} className="mx-auto mb-4 text-accent" /><h3 className="text-xl font-semibold">Build your local shelf</h3><p className="mt-2 text-text-muted">PDFs and their cover previews stay in this browser.</p></div>
                    </div>
                )}
            </div>
        </main>
    );
}
