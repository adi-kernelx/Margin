
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useFileSystemStore } from '@/lib/firestore-fs-store';
import {
    Folder,
    FileText,
    ChevronRight,
    ChevronDown,
    FolderPlus,
    FilePlus,
    Trash2,
    Edit2,
    UploadCloud,
    Loader2,
    Download,
    Share2
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { type FirestoreFolder, type FirestoreFileMetadata } from '@/types/firestore';
import { uploadService } from '@/lib/upload-service';
import { ShareDialog } from './ShareDialog';

interface FileTreeProps {
    onSelectFolder: (id: string) => void;
    onOpenFile?: (file: FirestoreFileMetadata) => void;
}

export function FileTree({ onOpenFile }: Omit<FileTreeProps, 'onSelectFolder'>) {
    const { isDarkMode } = useAppStore();
    const {
        folders,
        currentFolderId,
        initialize,
        createFolder,
        createFileEntry
    } = useFileSystemStore();

    // Dialog State
    const [shareDialog, setShareDialog] = useState<{ id: string; type: 'file' | 'folder'; name: string } | null>(null);

    useEffect(() => {
        initialize();
    }, [initialize]);

    const rootFolder = folders['root'];

    const handleCreateFolder = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentFolderId) return;
        const name = prompt("Enter folder name:");
        if (name) await createFolder(name, currentFolderId);
    };

    const handleCreateFile = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentFolderId) return;
        const name = prompt("Enter file name (Metadata only):");
        if (name) await createFileEntry(name, currentFolderId);
    };

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);

    const handleUploadClick = () => {
        if (!currentFolderId) {
            alert("Please select a folder first.");
            return;
        }
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentFolderId) return;

        setUploading(true);
        try {
            await uploadService.uploadFile(file, currentFolderId);
            window.location.reload(); // Refresh to show synced file
        } catch (err: any) {
            alert(`Upload failed: ${err.message}`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    if (!rootFolder) {
        return <div className="p-4 text-xs text-center opacity-50">Loading Files...</div>;
    }

    return (
        <div className={cn(
            "flex flex-col h-full w-full",
            isDarkMode ? "text-gray-300" : "text-gray-700"
        )}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <span className="text-xs font-semibold uppercase tracking-wider">Explorer</span>
                <div className="flex gap-1">
                    <button
                        onClick={handleCreateFolder}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="New Folder"
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={handleCreateFile}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title="New Dummy File"
                    >
                        <FilePlus size={14} />
                    </button>
                    <button
                        onClick={handleUploadClick}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded relative"
                        title="Upload PDF (Max 5 Free)"
                    >
                        <UploadCloud size={14} />
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-black/50 rounded">
                                <Loader2 size={10} className="animate-spin text-blue-600" />
                            </div>
                        )}
                    </button>
                </div>
            </div>


            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="application/pdf"
                onChange={handleFileChange}
            />

            <div className="flex-1 overflow-y-auto p-2">
                {/* My Files Section */}
                <div className="mb-2">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1">
                        My Files
                    </div>
                    <FolderNode
                        folder={rootFolder}
                        depth={0}
                        onOpenFile={onOpenFile}
                        onShare={(id, name) => setShareDialog({ id, type: 'folder', name })}
                        onShareFile={(id, name) => setShareDialog({ id, type: 'file', name })}
                    />
                </div>

                {/* Shared Sections */}
                {folders['shared-with-me'] && (
                    <div className="mb-2 mt-4">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1">
                            Shared With You
                        </div>
                        <FolderNode
                            folder={folders['shared-with-me']}
                            depth={0}
                            onOpenFile={onOpenFile}
                            onShare={(id, name) => setShareDialog({ id, type: 'folder', name })}
                            onShareFile={(id, name) => setShareDialog({ id, type: 'file', name })}
                            hideActions={true}
                        />
                    </div>
                )}
                {folders['shared-by-me'] && (
                    <div className="mb-2 mt-4">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2 mb-1">
                            Shared By You
                        </div>
                        <FolderNode
                            folder={folders['shared-by-me']}
                            depth={0}
                            onOpenFile={onOpenFile}
                            onShare={(id, name) => setShareDialog({ id, type: 'folder', name })}
                            onShareFile={(id, name) => setShareDialog({ id, type: 'file', name })}
                            hideActions={true}
                        />
                    </div>
                )}
            </div>

            {shareDialog && (
                <ShareDialog
                    scopeId={shareDialog.id}
                    scopeType={shareDialog.type}
                    name={shareDialog.name}
                    onClose={() => setShareDialog(null)}
                />
            )}
        </div>
    );
}

function FolderNode({ folder, depth, onOpenFile, onShare, onShareFile, hideActions }: {
    folder: FirestoreFolder,
    depth: number,
    onOpenFile?: (file: FirestoreFileMetadata) => void,
    onShare: (id: string, name: string) => void,
    onShareFile: (id: string, name: string) => void,
    hideActions?: boolean
}) {
    const {
        folders,
        files,
        currentFolderId,
        setCurrentFolderId,
        loadFolderContents,
        renameFolder,
        deleteFolder,
        renameFile,
        deleteFile
    } = useFileSystemStore();

    const [isOpen, setIsOpen] = useState(depth === 0); // Open root by default
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(folder.name);
    const editInputRef = useRef<HTMLInputElement>(null);

    const childFolders = Object.values(folders)
        .filter(f => f.parentFolderId === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name));

    const childFiles = files[folder.id] || [];

    const isSelected = currentFolderId === folder.id;

    const toggleOpen = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen) {
            await loadFolderContents(folder.id);
        }
        setIsOpen(!isOpen);
        setCurrentFolderId(folder.id);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        // TODO: Custom context menu
    };

    const handleRename = async () => {
        if (editName.trim() && editName !== folder.name) {
            await renameFolder(folder.id, editName);
        }
        setIsEditing(false);
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${folder.name}" and all contents?`)) {
            await deleteFolder(folder.id, folder.parentFolderId ?? undefined);
        }
    };

    const handleDownload = async (file: FirestoreFileMetadata) => {
        if (file.status !== 'synced' && file.storageType !== 'cloud') return;
        try {
            const url = await uploadService.getDownloadUrl(file.id, file.parentFolderId, file.ownerUid);
            window.open(url, '_blank');
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleFileClick = (file: FirestoreFileMetadata) => {
        // Relax check: allow if synced OR if it's a cloud file (assumed synced if listed)
        if ((file.status === 'synced' || file.storageType === 'cloud') && onOpenFile) {
            onOpenFile(file);
        }
    };

    useEffect(() => {
        if (isEditing && editInputRef.current) {
            editInputRef.current.focus();
        }
    }, [isEditing]);

    useEffect(() => {
        if (isOpen) {
            loadFolderContents(folder.id);
        }
    }, [isOpen, folder.id]);

    return (
        <div className="select-none">
            <div
                className={cn(
                    "flex items-center group py-1 px-2 rounded-md cursor-pointer transition-colors",
                    isSelected
                        ? "bg-blue-100 dark:bg-blue-900/30 text-black dark:text-blue-300 font-medium"
                        : "hover:bg-gray-500 dark:hover:bg-gray-800"
                )}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
                onClick={toggleOpen}
                onContextMenu={handleContextMenu}
            >
                <div className="flex items-center justify-center w-4 h-4 mr-1 text-gray-400">
                    {(childFolders.length > 0 || childFiles.length > 0) && (
                        isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />
                    )}
                </div>

                <Folder size={16} className={cn("mr-2", isSelected ? "fill-blue-200 dark:fill-blue-900" : "fill-none")} />

                {isEditing ? (
                    <input
                        ref={editInputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={handleRename}
                        onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 min-w-0 bg-white dark:bg-gray-950 border border-blue-500 rounded px-1 text-xs"
                    />
                ) : (
                    <span className="truncate flex-1 text-sm">{folder.name}</span>
                )}

                {/* Actions (visible on hover or selected) */}
                {/* Actions (visible on hover or selected) */}
                {folder.id !== 'root' && (
                    <div className={cn(
                        "items-center gap-1 ml-auto",
                        isSelected ? "flex" : "hidden group-hover:flex"
                    )}>
                        <button
                            onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                    await uploadService.downloadFolderZip(folder.id, folder.name, (folder as any).ownerUid);
                                } catch (err: any) {
                                    console.error(err);
                                    if (err.message.includes('Access denied') || err.message.includes('403') || err.message.includes('410') || err.message.includes('404')) {
                                        alert("Download unavailable. Please contact the owner to update permissions.");
                                    } else {
                                        alert(`Download failed: ${err.message}`);
                                    }
                                }
                            }}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                            title="Download Zip"
                        >
                            <Download size={12} />
                        </button>

                        {!hideActions && (
                            <>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onShare(folder.id, folder.name); }}
                                    className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded text-blue-500"
                                    title="Share Folder"
                                >
                                    <Share2 size={12} />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                                >
                                    <Edit2 size={12} />
                                </button>
                                <button
                                    onClick={handleDelete}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {isOpen && (
                <div>
                    {childFolders.map(child => (
                        <FolderNode
                            key={child.id}
                            folder={child}
                            depth={depth + 1}
                            onOpenFile={onOpenFile}
                            onShare={onShare}
                            onShareFile={onShareFile}
                            hideActions={hideActions}
                        />
                    ))}
                    {childFiles.map(file => (
                        <FileNode
                            key={file.id}
                            file={file}
                            depth={depth + 1}
                            onRename={renameFile}
                            onDelete={deleteFile}
                            onClick={() => handleFileClick(file)}
                            onDownload={() => handleDownload(file)}
                            onShare={() => onShareFile(file.id, file.name)}
                            hideActions={hideActions}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FileNode({ file, depth, onRename, onDelete, onClick, onDownload, onShare, hideActions }: {
    file: FirestoreFileMetadata,
    depth: number,
    onRename: (fid: string, id: string, name: string) => Promise<void>,
    onDelete: (fid: string, id: string) => Promise<void>,
    onClick: () => void,
    onDownload: () => void,
    onShare: () => void,
    hideActions?: boolean
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(file.name);
    const editInputRef = useRef<HTMLInputElement>(null);

    const handleRename = async () => {
        if (editName.trim() && editName !== file.name) {
            await onRename(file.parentFolderId, file.id, editName);
        }
        setIsEditing(false);
    };

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm(`Delete file "${file.name}"?`)) {
            await onDelete(file.parentFolderId, file.id);
        }
    };

    useEffect(() => {
        if (isEditing && editInputRef.current) {
            editInputRef.current.focus();
        }
    }, [isEditing]);

    return (
        <div
            className="flex items-center group py-1 px-2 rounded-md cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            style={{ paddingLeft: `${depth * 12 + 28}px` }} // +28 for folder icon offset
            onClick={onClick}
            title={file.storageType === 'cloud' ? "Cloud File" : "Local File"}
        >
            <div className="mr-2">
                {file.status === 'uploading' ? (
                    <Loader2 size={14} className="animate-spin text-blue-500" />
                ) : (
                    <FileText size={14} className={cn(file.status === 'synced' ? "text-blue-600" : "text-black")} />
                )}
            </div>
            {/* Show storage type indicator */}
            <div className="mr-1 text-[10px] text-gray-400 font-mono uppercase">
                {file.storageType === 'cloud' ? 'Cloud' : 'Local'}
            </div>

            {isEditing ? (
                <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-white dark:bg-gray-950 border border-blue-500 rounded px-1 text-xs"
                />
            ) : (
                <span className="truncate flex-1 text-sm text-gray-600 dark:text-gray-400">{file.name}</span>
            )}

            {/* Actions (visible on hover or selected) */}
            <div className="hidden group-hover:flex items-center gap-1 ml-auto">
                {/* Share Button (Only for Cloud) */}
                {file.storageType === 'cloud' && !hideActions && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onShare(); }}
                        className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded text-blue-500"
                        title="Share File"
                    >
                        <Share2 size={12} />
                    </button>
                )}

                <button
                    onClick={(e) => { e.stopPropagation(); onDownload(); }}
                    className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                    title="Download PDF"
                >
                    <Download size={12} />
                </button>

                {!hideActions && (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                        >
                            <Edit2 size={12} />
                        </button>
                        <button
                            onClick={handleDelete}
                            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500"
                        >
                            <Trash2 size={12} />
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
