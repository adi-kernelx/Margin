import React, { useEffect, useState, useRef } from 'react';
import { cloudService, type CloudFile } from '@/lib/cloud-service';
import { Loader2, UploadCloud, FileText, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';


interface CloudFileManagerProps {
    onOpenFile: (file: CloudFile) => void;
}

export function CloudFileManager({ onOpenFile }: CloudFileManagerProps) {
    const [files, setFiles] = useState<CloudFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = async () => {
        setLoading(true);
        try {
            const list = await cloudService.listFiles();
            setFiles(list);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFiles();
    }, []);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            await cloudService.uploadFile(file);
            await loadFiles();
        } catch (err) {
            alert('Upload failed');
            console.error(err);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="flex flex-col h-full w-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                <h3 className="text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">Cloud Storage</h3>
                <div className="flex gap-2">
                    <button
                        onClick={loadFiles}
                        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    </button>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-xs font-medium transition-colors"
                        disabled={uploading}
                    >
                        {uploading ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                        Upload
                    </button>
                </div>
            </div>

            <input
                type="file"
                ref={fileInputRef}
                accept="application/pdf"
                className="hidden"
                onChange={handleUpload}
            />

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2">
                {(!files || files.length === 0) && !loading ? (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm">
                        <UploadCloud size={32} className="mb-2 opacity-50" />
                        <p>No files yet</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {files && files.map(file => (
                            <div
                                key={file.fileId}
                                onClick={() => onOpenFile(file)}
                                className={cn(
                                    "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors group",
                                    "hover:bg-gray-100 dark:hover:bg-gray-800",
                                    "border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                                )}
                            >
                                <div className="p-2 bg-red-100 dark:bg-red-900/20 text-red-600 rounded">
                                    <FileText size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                        {file.displayName}
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {new Date(file.updatedAt).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
