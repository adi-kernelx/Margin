import { useCollabStore } from '@/lib/collab-store';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

interface CollabUserListProps {
    fileId: string;
    className?: string;
}

export function CollabUserList({ fileId, className }: CollabUserListProps) {
    const users = useCollabStore(state => state.activeUsers[fileId]);
    const { isDarkMode } = useAppStore();

    if (!users || users.length === 0) return null;

    return (
        <div className={cn(
            "absolute top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none",
            className
        )}>
            {users.map(user => (
                <div
                    key={user.connectedAt + user.uid}
                    title={user.email || (user.name.startsWith('Anonymous') ? 'Anonymous' : user.name)}
                    className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm pointer-events-auto transition-all animate-in fade-in slide-in-from-right-4",
                        isDarkMode ? "bg-gray-800/90 text-white" : "bg-white/90 text-gray-900 border"
                    )}
                    style={{ borderLeft: `3px solid ${user.color}` }}
                >
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: user.color }} />
                    <span className="text-xs font-medium max-w-[100px] truncate">
                        {user.name}
                    </span>
                    {/* Role badge if needed, e.g. (Edit) */}
                </div>
            ))}
        </div>
    );
}
