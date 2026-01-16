import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { shareService } from '@/lib/share-service';
import { PDFViewer } from '@/components/PDFViewer';
import { useAuthStore } from '@/lib/auth-store';
import { Loader2, AlertCircle, Download } from 'lucide-react';

export default function SharedLinkHandler() {
    const { shareId } = useParams<{ shareId: string }>();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('t');

    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading: authLoading } = useAuthStore();

    const [status, setStatus] = useState<'loading' | 'error' | 'success'>('loading');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [data, setData] = useState<any>(null);

    const [viewingFile, setViewingFile] = useState<{ id: string, name: string, url: string, annotationsUrl?: string } | null>(null);
    const [folderChildren, setFolderChildren] = useState<any[]>([]);

    useEffect(() => {
        if (!shareId || !token || authLoading) return;

        const load = async () => {
            try {
                const res = await shareService.resolveLink(shareId, token);

                setData(res);
                setStatus('success');

                if (res.meta.type === 'folder') {
                    if (user) {
                        navigate('/');
                        return;
                    }

                    try {
                        const childrenRes = await shareService.resolveLinkChildren(shareId, token);
                        setFolderChildren(childrenRes.items || []);
                    } catch (e) {
                        console.error("Failed to load children", e);
                    }
                }

            } catch (err: any) {
                console.error(err);
                if (err.message === 'AUTH_REQUIRED') {
                    navigate('/login', { state: { from: location } });
                } else {
                    setStatus('error');
                    setErrorMsg(err.message || "Failed to load shared item.");
                }
            }
        };

        load();
    }, [shareId, token, authLoading, user, navigate, location]);

    const handleFileClick = async (file: any) => {
        if (file.kind === 'folder') return;

        try {
            if (!shareId || !token) return;
            const res = await shareService.resolveNestedFile(shareId, token, file.id);
            if (res.ok && res.pdfUrl) {
                setViewingFile({
                    id: file.id,
                    name: file.name,
                    url: res.pdfUrl,
                    annotationsUrl: res.annotationsUrl
                });
            }
        } catch (e) {
            console.error("Failed to open file", e);
            alert("Failed to open file");
        }
    };

    const handleDownload = async (e: React.MouseEvent, item: any) => {
        e.stopPropagation();
        try {
            if (item.kind === 'file') {
                const res = await shareService.resolveNestedFile(shareId!, token!, item.id);
                if (res.ok && res.pdfUrl) {
                    const link = document.createElement('a');
                    link.href = res.pdfUrl;
                    link.download = item.name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            } else {
                // Folder Download (Zip)
                alert("Downloading folder as zip...");
                // TODO: Implement zip endpoint
                // const res = await (shareService as any).downloadFolderZip(shareId!, token!, item.id);
            }
        } catch (err) {
            console.error("Download failed", err);
            alert("Download failed");
        }
    };

    if (authLoading || status === 'loading') {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 gap-4">
                <Loader2 className="animate-spin text-blue-600" size={32} />
                <p className="text-gray-500 text-sm">Verifying link...</p>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-4">
                    <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                        <AlertCircle className="text-red-600 dark:text-red-400" size={24} />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Unable to access</h1>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">{errorMsg}</p>
                    <button
                        onClick={() => navigate('/')}
                        className="w-full py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    // Success
    if (data) {
        // CASE 1: Single File Share
        if (data.meta.type === 'file') {
            return (
                <div className="h-screen w-screen flex flex-col bg-gray-100 dark:bg-gray-900">
                    <Header data={data} user={user} navigate={navigate} downloadUrl={data.pdfUrl} />
                    <div className="flex-1 overflow-hidden relative">
                        <PDFViewer
                            file={null}
                            fileUrl={data.pdfUrl}
                            fileId={data.meta.id}
                            stableId={data.meta.id}
                            displayName={data.meta.name}
                            role={data.role === 'view' ? 'viewer' : 'editor'}
                            parentFolderId={data.meta.parentId}
                            annotationsUrl={data.annotationsUrl}
                            shareId={shareId}
                            linkToken={token || undefined}
                        />
                    </div>
                </div>
            );
        }

        // CASE 2: Folder Share (Anonymous / View Only)
        if (viewingFile) {
            return (
                <div className="h-screen w-screen flex flex-col bg-gray-100 dark:bg-gray-900">
                    <div className="h-14 border-b bg-white dark:bg-gray-800 flex items-center px-4 justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                {viewingFile.name}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {viewingFile.url && (
                                <a
                                    href={viewingFile.url}
                                    download={viewingFile.name || "download.pdf"}
                                    className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mr-2"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Download
                                </a>
                            )}
                            <button onClick={() => setViewingFile(null)} className="text-sm text-blue-600 hover:underline">
                                Back to Folder
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-hidden relative">
                        <PDFViewer
                            file={null}
                            fileUrl={viewingFile.url}
                            fileId={viewingFile.id}
                            stableId={viewingFile.id}
                            displayName={viewingFile.name}
                            role={'viewer'}
                            parentFolderId={data.meta.id}
                            annotationsUrl={viewingFile.annotationsUrl}
                            shareId={shareId}
                            linkToken={token || undefined}
                        />
                    </div>
                </div>
            );
        }

        // Folder List
        return (
            <div className="h-screen w-screen flex flex-col bg-gray-50 dark:bg-gray-900">
                <Header data={data} user={user} navigate={navigate} />

                <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
                        <div className="p-4 border-b dark:border-gray-700">
                            <h2 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                                📁 {data.meta.name}
                            </h2>
                            <p className="text-xs text-gray-500 mt-1">Shared Folder • {folderChildren.length} items</p>
                        </div>
                        <div className="divide-y dark:divide-gray-700">
                            {folderChildren.length === 0 ? (
                                <div className="p-8 text-center text-gray-500 text-sm">
                                    Empty folder
                                </div>
                            ) : (
                                folderChildren.map(item => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleFileClick(item)}
                                        className={`flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group ${item.kind === 'file' ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-xl">
                                                {item.kind === 'folder' ? '📂' : '📄'}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                                                <div className="text-xs text-gray-500">
                                                    {item.kind === 'file' ? (item.size ? formatSize(item.size) : 'PDF') : 'Folder'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => handleDownload(e, item)}
                                                className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
                                                title="Download"
                                            >
                                                <Download size={18} />
                                            </button>
                                            {item.kind === 'folder' && <span className="text-xs text-gray-400">(Nested unavail)</span>}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

function Header({ data, user, navigate, downloadUrl }: any) {
    return (
        <div className="h-14 border-b bg-white dark:bg-gray-800 flex items-center px-4 justify-between shrink-0">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[200px] md:max-w-md">
                    {data.meta.name}
                </span>
                <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full font-medium capitalize">
                    {data.role}
                </span>
            </div>
            <div className="flex items-center gap-2">
                {downloadUrl && (
                    <a
                        href={downloadUrl}
                        download={data.meta.name || "download.pdf"}
                        className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors mr-2"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Download
                    </a>
                )}
                {user ? (
                    <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
                        Dashboard
                    </button>
                ) : (
                    <button onClick={() => navigate('/login')} className="text-sm text-blue-600 hover:underline">
                        Login to Save
                    </button>
                )}
            </div>
        </div>
    );
}

function formatSize(bytes: number) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
