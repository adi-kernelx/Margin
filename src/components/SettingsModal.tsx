import { X, Moon, Sun, Info } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { isDarkMode, toggleDarkMode } = useAppStore();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div
                className={cn(
                    "w-full max-w-md rounded-xl shadow-2xl overflow-hidden border",
                    isDarkMode ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className={cn(
                    "px-4 py-3 border-b flex items-center justify-between",
                    isDarkMode ? "bg-gray-900/50 border-gray-700" : "bg-gray-50 border-gray-100"
                )}>
                    <h2 className={cn("font-semibold", isDarkMode ? "text-gray-100" : "text-gray-800")}>
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className={cn(
                            "p-1 rounded-md transition-colors",
                            isDarkMode ? "hover:bg-gray-700 text-gray-400" : "hover:bg-gray-200 text-gray-500"
                        )}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">

                    {/* Appearance Section */}
                    <div className="space-y-2">
                        <h3 className={cn("text-xs font-semibold uppercase tracking-wider", isDarkMode ? "text-gray-500" : "text-gray-400")}>
                            Appearance
                        </h3>
                        <div
                            onClick={toggleDarkMode}
                            className={cn(
                                "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all",
                                isDarkMode
                                    ? "bg-gray-700/50 border-gray-700 hover:bg-gray-700"
                                    : "bg-white border-gray-200 hover:bg-gray-50"
                            )}
                        >
                            <div className="flex items-center gap-3">
                                <div className={cn(
                                    "p-2 rounded-full",
                                    isDarkMode ? "bg-gray-800 text-yellow-400" : "bg-amber-100 text-amber-600"
                                )}>
                                    {isDarkMode ? <Moon size={18} /> : <Sun size={18} />}
                                </div>
                                <div className="flex flex-col">
                                    <span className={cn("text-sm font-medium", isDarkMode ? "text-gray-200" : "text-gray-900")}>
                                        Theme
                                    </span>
                                    <span className={cn("text-xs", isDarkMode ? "text-gray-400" : "text-gray-500")}>
                                        {isDarkMode ? "Dark Mode" : "Light Mode"}
                                    </span>
                                </div>
                            </div>
                            <div className={cn(
                                "w-10 h-6 rounded-full relative transition-colors",
                                isDarkMode ? "bg-blue-600" : "bg-gray-300"
                            )}>
                                <div className={cn(
                                    "absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                                    isDarkMode ? "translate-x-4" : "translate-x-0"
                                )} />
                            </div>
                        </div>
                    </div>

                    {/* About Section */}
                    <div className="space-y-2 pt-2">
                        <h3 className={cn("text-xs font-semibold uppercase tracking-wider", isDarkMode ? "text-gray-500" : "text-gray-400")}>
                            About
                        </h3>
                        <div className={cn(
                            "p-3 rounded-lg border flex items-start gap-3",
                            isDarkMode ? "bg-blue-900/10 border-blue-900/20" : "bg-blue-50 border-blue-100"
                        )}>
                            <Info size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
                            <div className="space-y-1">
                                <p className={cn("text-sm font-medium", isDarkMode ? "text-blue-400" : "text-blue-700")}>
                                    PDF Reader v0.1
                                </p>
                                <p className={cn("text-xs leading-relaxed", isDarkMode ? "text-gray-400" : "text-gray-600")}>
                                    A powerful, local-first PDF annotation tool. Built with React, PDF.js, and Zustand.
                                </p>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className={cn(
                    "px-4 py-3 border-t flex justify-end",
                    isDarkMode ? "bg-gray-900/50 border-gray-700" : "bg-gray-50 border-gray-100"
                )}>
                    <button
                        onClick={onClose}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            isDarkMode
                                ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                                : "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm"
                        )}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
