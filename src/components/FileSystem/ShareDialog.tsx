import { useState, useEffect } from 'react';
import { X, Search, UserMinus, UserPlus, Check, Loader2, Users, Link2, Trash2, ExternalLink, Clock, Eye, Edit3, Copy } from 'lucide-react';
import { shareService } from '@/lib/share-service';
import type { SharePermission, UserResult, ShareLink } from '@/lib/share-service';
import { cn } from '@/lib/utils';

interface ShareDialogProps {
    scopeId: string;
    scopeType: 'file' | 'folder';
    name: string;
    onClose: () => void;
}

export function ShareDialog({ scopeId, scopeType, name, onClose }: ShareDialogProps) {
    const [activeTab, setActiveTab] = useState<'people' | 'permissions' | 'link'>('people');
    const [permissions, setPermissions] = useState<SharePermission[]>([]);
    const [loadingPerms, setLoadingPerms] = useState(true);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<UserResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedRole, setSelectedRole] = useState<'view' | 'edit'>('view');

    // Link State
    const [linkUrl, setLinkUrl] = useState<string | null>(null);
    const [expiryOption, setExpiryOption] = useState<'1d' | '7d' | '30d' | '1y' | 'never'>('7d');
    const [existingLinks, setExistingLinks] = useState<ShareLink[]>([]);
    const [loadingLinks, setLoadingLinks] = useState(false);

    // Error
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadPermissions();
    }, [scopeId]);

    // Load links when switching to link tab
    useEffect(() => {
        if (activeTab === 'link') {
            loadLinks();
        }
    }, [activeTab, scopeId]);

    // Debounced Search
    useEffect(() => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            setSearching(true);
            try {
                const results = await shareService.listUsers(searchQuery);
                setSearchResults(results);
            } catch (err: any) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const loadPermissions = async () => {
        setLoadingPerms(true);
        setError(null);
        try {
            const list = await shareService.listPermissions(scopeId, scopeType);
            setPermissions(list);
        } catch (err: any) {
            console.error(err);
            // Likely not owner
            if (err.message && err.message.includes('Only the owner')) {
                setError("You are not the owner of this item.");
            } else {
                setError("Failed to load permissions.");
            }
        } finally {
            setLoadingPerms(false);
        }
    };

    const loadLinks = async () => {
        setLoadingLinks(true);
        try {
            const links = await shareService.listLinks(scopeId, scopeType);
            setExistingLinks(links);
        } catch (err: any) {
            console.error('Failed to load links:', err);
        } finally {
            setLoadingLinks(false);
        }
    };

    const handleShare = async (user: UserResult) => {
        try {
            await shareService.shareUser(user.uid, scopeId, scopeType, selectedRole);
            setSearchQuery('');
            setSearchResults([]);
            setActiveTab('permissions'); // switch to show listed
            await loadPermissions();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleRevoke = async (uid: string) => {
        if (!confirm('Revoke access?')) return;
        try {
            await shareService.revokeUser(uid, scopeId, scopeType);
            await loadPermissions();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleUpdateRole = async (targetUid: string, newRole: 'view' | 'edit') => {
        try {
            await shareService.updateUserRole(targetUid, scopeId, scopeType, newRole);
            await loadPermissions();
        } catch (err: any) {
            alert(err.message);
        }
    };

    const handleRevokeLink = async (shareId: string) => {
        if (!confirm('Revoke this share link? Anyone with this link will lose access.')) return;

        // Optimistic update: Mark as disabled immediately
        setExistingLinks(prev => prev.map(l => l.shareId === shareId ? { ...l, disabled: true } : l));

        try {
            await shareService.revokeLink(shareId);
        } catch (err: any) {
            console.error('Revoke failed:', err);
            // Even if API reports error, backend might have partially succeeded or it was a timeout
            // Alert user but still reload to get true state
            // alert(err.message); // Optional: suppress alert if we trust optimistic update? Better to warn.
            alert(`Action completed with warnings: ${err.message}`);
        } finally {
            // Always reload to get definitive server state
            await loadLinks();
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Never';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const isExpired = (expiresAt: string | null) => {
        if (!expiresAt) return false;
        return new Date(expiresAt) < new Date();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-0 overflow-hidden border dark:border-gray-700 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900/50">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Users size={18} /> Share "{name}"
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {error ? (
                        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-center text-sm rounded-lg">
                            {error}
                        </div>
                    ) : (
                        <>
                            {/* Search Box */}
                            <div className="space-y-2">
                                <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg mb-4">
                                    <button
                                        onClick={() => setActiveTab('people')}
                                        className={cn("flex-1 py-1 text-sm rounded-md transition-all", activeTab === 'people' ? "bg-white dark:bg-gray-700 shadow" : "text-gray-500 hover:text-gray-900")}
                                    >
                                        People
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('link')}
                                        className={cn("flex-1 py-1 text-sm rounded-md transition-all", activeTab === 'link' ? "bg-white dark:bg-gray-700 shadow" : "text-gray-500 hover:text-gray-900")}
                                    >
                                        Link
                                    </button>
                                </div>

                                {activeTab === 'people' ? (
                                    <>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                            <input
                                                type="text"
                                                placeholder="Search by email or name..."
                                                className="w-full pl-9 pr-24 py-2 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                            />
                                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center bg-gray-100 dark:bg-gray-800 rounded p-0.5">
                                                <select
                                                    value={selectedRole}
                                                    onChange={(e) => setSelectedRole(e.target.value as 'view' | 'edit')}
                                                    className="bg-transparent text-gray-900 border-none text-xs px-2 py-1 outline-none cursor-pointer"
                                                >
                                                    <option value="view">Viewer</option>
                                                    <option value="edit">Editor</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Results Dropdown */}
                                        {searchQuery && (
                                            <div className="border dark:border-gray-700 rounded-lg overflow-hidden max-h-40 overflow-y-auto bg-white dark:bg-gray-950 shadow-lg mt-1 relative">
                                                {searching ? (
                                                    <div className="p-3 text-center text-gray-500 text-xs"><Loader2 className="animate-spin inline mr-2 h-3 w-3" /> Searching...</div>
                                                ) : searchResults.length === 0 ? (
                                                    <div className="p-3 text-center text-gray-500 text-xs">No users found.</div>
                                                ) : (
                                                    searchResults.map(user => (
                                                        <div
                                                            key={user.uid}
                                                            className="flex items-center justify-between p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer"
                                                            onClick={() => handleShare(user)}
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-medium">{user.displayName || 'No Name'}</span>
                                                                <span className="text-xs text-gray-500">{user.email || 'No Email'}</span>
                                                            </div>
                                                            <UserPlus size={16} className="text-blue-500" />
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-4">
                                        {/* Create New Link Section */}
                                        <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border dark:border-gray-700">
                                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Create New Link</div>
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-medium">Access Level</label>
                                                <select
                                                    value={selectedRole}
                                                    onChange={(e) => setSelectedRole(e.target.value as 'view' | 'edit')}
                                                    className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border dark:border-gray-700 text-xs px-2 py-1 rounded outline-none cursor-pointer"
                                                >
                                                    <option value="view">Viewer</option>
                                                    <option value="edit">Editor</option>
                                                </select>
                                            </div>

                                            <div className="flex items-center justify-between mb-3">
                                                <label className="text-sm font-medium">Expires In</label>
                                                <select
                                                    value={expiryOption}
                                                    onChange={(e) => setExpiryOption(e.target.value as any)}
                                                    className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border dark:border-gray-700 text-xs px-2 py-1 rounded outline-none cursor-pointer"
                                                >
                                                    <option value="1d">1 Day</option>
                                                    <option value="7d">7 Days</option>
                                                    <option value="30d">30 Days</option>
                                                    <option value="1y">1 Year</option>
                                                    <option value="never">Never</option>
                                                </select>
                                            </div>

                                            <button
                                                onClick={async () => {
                                                    try {
                                                        let expiresAt: number | undefined;
                                                        if (expiryOption !== 'never') {
                                                            const now = Date.now();
                                                            switch (expiryOption) {
                                                                case '1d': expiresAt = now + 86400000; break;
                                                                case '7d': expiresAt = now + 7 * 86400000; break;
                                                                case '30d': expiresAt = now + 30 * 86400000; break;
                                                                case '1y': expiresAt = now + 365 * 86400000; break;
                                                            }
                                                        }

                                                        const res = await shareService.createLink(scopeId, scopeType, selectedRole, false, expiresAt);
                                                        setLinkUrl(res.url);
                                                        loadLinks(); // Refresh the existing links list
                                                    } catch (err: any) { alert(err.message); }
                                                }}
                                                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                                            >
                                                <Link2 size={14} />
                                                Create Link
                                            </button>

                                            {linkUrl && (
                                                <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                                                    <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1">Link Created!</div>
                                                    <div className="flex gap-2">
                                                        <input
                                                            readOnly
                                                            value={linkUrl}
                                                            className="flex-1 text-xs bg-white dark:bg-gray-900 border rounded px-2 py-1 select-all"
                                                        />
                                                        <button
                                                            onClick={() => navigator.clipboard.writeText(linkUrl)}
                                                            className="p-1.5 bg-white dark:bg-gray-800 border rounded hover:bg-gray-50"
                                                            title="Copy"
                                                        >
                                                            <Check size={14} className="text-green-600" />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Existing Links Section */}
                                        <div className="space-y-3 pt-3 border-t dark:border-gray-700">
                                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                                                <Link2 size={12} />
                                                Active Links ({existingLinks.filter(l => !l.disabled && !isExpired(l.expiresAt)).length})
                                            </div>

                                            {loadingLinks ? (
                                                <div className="flex justify-center py-4">
                                                    <Loader2 className="animate-spin text-gray-400" size={20} />
                                                </div>
                                            ) : existingLinks.filter(l => !l.disabled && !isExpired(l.expiresAt)).length === 0 ? (
                                                <div className="text-sm text-gray-500 italic bg-gray-50 dark:bg-gray-900/30 p-3 rounded">
                                                    No active links.
                                                </div>
                                            ) : (
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {existingLinks
                                                        .filter(l => !l.disabled && !isExpired(l.expiresAt))
                                                        .map((link) => (
                                                            <div
                                                                key={link.shareId}
                                                                className={cn(
                                                                    "p-3 bg-white dark:bg-gray-950 border dark:border-gray-700 rounded-lg"
                                                                )}
                                                            >
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <div className="flex items-center gap-2">
                                                                        {link.role === 'edit' ? (
                                                                            <Edit3 size={14} className="text-amber-500" />
                                                                        ) : (
                                                                            <Eye size={14} className="text-blue-500" />
                                                                        )}
                                                                        <span className={cn(
                                                                            "text-xs font-medium px-2 py-0.5 rounded-full",
                                                                            link.role === 'edit'
                                                                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                                        )}>
                                                                            {link.role === 'edit' ? 'Editor' : 'Viewer'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        {link.url && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    navigator.clipboard.writeText(link.url!);
                                                                                    alert("Link copied!");
                                                                                }}
                                                                                className="text-gray-400 hover:text-green-500 transition-colors p-1"
                                                                                title="Copy Link"
                                                                            >
                                                                                <Copy size={14} />
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => handleRevokeLink(link.shareId)}
                                                                            className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                                                            title="Revoke link"
                                                                        >
                                                                            <Trash2 size={14} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                                                                    <div className="flex items-center gap-1">
                                                                        <Clock size={10} />
                                                                        Created: {formatDate(link.createdAt)}
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        <Clock size={10} />
                                                                        Expires: {formatDate(link.expiresAt)}
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        <ExternalLink size={10} />
                                                                        Used: {link.usageCount} times
                                                                    </div>
                                                                    {link.lastUsedAt && (
                                                                        <div className="flex items-center gap-1">
                                                                            <Clock size={10} />
                                                                            Last: {formatDate(link.lastUsedAt)}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Current Access List (Only show for People tab or always? Steps said show link access types... maybe later. Keep simple) */}
                            {activeTab === 'people' && (
                                <div className="space-y-3 pt-4 border-t dark:border-gray-700">
                                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">With Access</label>
                                    {loadingPerms ? (
                                        <div className="flex justify-center py-4">
                                            <Loader2 className="animate-spin text-gray-400" size={20} />
                                        </div>
                                    ) : permissions.length === 0 ? (
                                        <div className="text-sm text-gray-500 italic bg-gray-50 dark:bg-gray-900/30 p-3 rounded">
                                            Not shared with anyone yet.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {permissions.map((perm) => (
                                                <div key={perm.uid} className="flex items-center justify-between p-3 bg-white dark:bg-gray-950 border dark:border-gray-700 rounded-lg">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                                                            {perm.displayName?.[0]?.toUpperCase() || 'U'}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                {perm.displayName || 'Unknown User'}
                                                            </div>
                                                            <div className="text-xs text-gray-500">
                                                                {perm.email}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <select
                                                            value={perm.role}
                                                            onChange={(e) => handleUpdateRole(perm.uid, e.target.value as 'view' | 'edit')}
                                                            className="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-none text-xs px-2 py-1 rounded outline-none cursor-pointer"
                                                        >
                                                            <option value="view">Viewer</option>
                                                            <option value="edit">Editor</option>
                                                        </select>
                                                        <button
                                                            onClick={() => handleRevoke(perm.uid)}
                                                            className="text-gray-400 hover:text-red-500 transition-colors p-2"
                                                            title="Remove access"
                                                        >
                                                            <UserMinus size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
