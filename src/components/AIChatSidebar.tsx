import { X, MessageSquare, Plus, Clock, Send, FileText, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useState, useRef, useEffect } from 'react';
import { queryRag, createSessionId, type Source } from '@/lib/rag-service';

interface AIChatSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    variant?: 'overlay' | 'embedded';
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    sources?: Source[];
    metrics?: Record<string, number>;
    isError?: boolean;
}

// Mock data for past chats (To be replaced with persistence later)
const MOCK_CHATS = [
    { id: '1', title: 'Summary of Introduction', date: '2 hours ago' },
];

export function AIChatSidebar({ isOpen, onClose, variant = 'overlay' }: AIChatSidebarProps) {
    const { isDarkMode, focusedDocId } = useAppStore();
    const [activeView, setActiveView] = useState<'home' | 'chat'>('home');

    // Chat State
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // Auto-focus input when entering chat view
    useEffect(() => {
        if (activeView === 'chat' && isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [activeView, isOpen]);

    const handleNewChat = () => {
        setMessages([]);
        setSessionId(createSessionId());
        setActiveView('chat');
    };

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            text: input.trim(),
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            // Determine scope: if we have a focused doc, limit to it
            // Future: Allow user to toggle "Global" vs "Current Doc"
            const scope = focusedDocId ? { docIds: [focusedDocId] } : undefined;

            const response = await queryRag({
                question: userMsg.text,
                sessionId: sessionId || undefined,
                scope: scope,
                mode: 'qa' // Default mode
            });

            const aiMsg: Message = {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: response.answer,
                sources: response.sources,
                metrics: response.metrics
            };

            setMessages(prev => [...prev, aiMsg]);

        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, {
                id: crypto.randomUUID(),
                role: 'assistant',
                text: 'Sorry, I encountered an error. Please check if the RAG service is running (Port 9101).',
                isError: true
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const isOverlay = variant === 'overlay';

    return (
        <>
            {/* Backdrop (Only in overlay mode) */}
            {isOverlay && isOpen && (
                <div
                    className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <div className={cn(
                // Base styles
                "shadow-2xl flex flex-col transition-all duration-300 ease-in-out border-l z-50 overflow-hidden",
                // Theme styles
                isDarkMode ? "bg-gray-900 border-gray-800 text-gray-100" : "bg-white border-gray-200 text-gray-900",
                // Variant specific styles
                isOverlay
                    ? `fixed top-0 right-0 h-full w-[400px] transform ${isOpen ? "translate-x-0" : "translate-x-full"}`
                    : `h-full ${isOpen ? "w-[400px] opacity-100" : "w-0 opacity-0 border-l-0"}`
            )}>
                {/* Header */}
                <div className={cn(
                    "h-14 flex items-center justify-between px-4 border-b shrink-0",
                    isDarkMode ? "border-gray-800" : "border-gray-100"
                )}>
                    <div className="flex items-center gap-2 font-semibold">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        <span>AI Assistant</span>
                    </div>
                    <button
                        onClick={onClose}
                        className={cn(
                            "p-1 rounded-full hover:bg-gray-100 transition-colors",
                            isDarkMode ? "hover:bg-gray-800" : "hover:bg-gray-100"
                        )}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {activeView === 'home' ? (
                        <div className="p-4 space-y-6 overflow-y-auto">
                            {/* New Chat Button */}
                            <button
                                onClick={handleNewChat}
                                className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-sm flex items-center justify-center gap-2 font-medium transition-colors"
                            >
                                <Plus size={20} />
                                New Chat
                            </button>

                            {/* Recent Chats Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm text-gray-500">
                                    <span className="font-medium">Recent Chats</span>
                                    <Clock size={14} />
                                </div>

                                <div className="space-y-2">
                                    {MOCK_CHATS.map(chat => (
                                        <button
                                            key={chat.id}
                                            className={cn(
                                                "w-full text-left p-3 rounded-lg border transition-all group",
                                                isDarkMode
                                                    ? "border-gray-800 hover:bg-gray-800 hover:border-gray-700"
                                                    : "border-gray-100 hover:bg-gray-50 hover:border-gray-200"
                                            )}
                                        >
                                            <div className="font-medium text-sm truncate">{chat.title}</div>
                                            <div className="text-xs text-gray-400 mt-1">{chat.date}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col h-full overflow-hidden">
                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {messages.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
                                        <div className={cn("p-4 rounded-full mb-2", isDarkMode ? "bg-gray-800" : "bg-gray-100")}>
                                            <MessageSquare className="w-8 h-8 opacity-50" />
                                        </div>
                                        <p>Ask questions about your documents.</p>
                                        {focusedDocId && (
                                            <p className="text-xs text-purple-500 bg-purple-500/10 px-2 py-1 rounded">
                                                Context: Current Document
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    messages.map((msg) => (
                                        <div
                                            key={msg.id}
                                            className={cn(
                                                "flex flex-col max-w-[85%] space-y-1",
                                                msg.role === 'user' ? "self-end items-end" : "self-start items-start"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "p-3 rounded-2xl text-sm leading-relaxed",
                                                    msg.role === 'user'
                                                        ? "bg-purple-600 text-white rounded-br-none"
                                                        : cn(
                                                            "rounded-bl-none border shadow-sm",
                                                            isDarkMode
                                                                ? "bg-gray-800 border-gray-700 text-gray-100"
                                                                : "bg-white border-gray-200 text-gray-800",
                                                            msg.isError && "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200"
                                                        )
                                                )}
                                            >
                                                {msg.text}
                                            </div>

                                            {/* Sources */}
                                            {msg.sources && msg.sources.length > 0 && (
                                                <div className="flex flex-wrap gap-2 mt-1 px-1">
                                                    {msg.sources.map((source, idx) => (
                                                        <span
                                                            key={idx}
                                                            className={cn(
                                                                "text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border opacity-75 hover:opacity-100 cursor-pointer transition-opacity",
                                                                isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                                                            )}
                                                            title={source.text}
                                                        >
                                                            <FileText size={10} />
                                                            p.{source.page}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}

                                {isLoading && (
                                    <div className="self-start flex items-center gap-2 text-gray-400 text-sm p-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Thinking...</span>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Input Area */}
                            <div className={cn(
                                "p-4 border-t sticky bottom-0 z-10",
                                isDarkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-100"
                            )}>
                                <div className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-xl border focus-within:ring-2 focus-within:ring-purple-500/20 transition-all",
                                    isDarkMode ? "bg-gray-800 border-gray-700" : "bg-gray-50 border-gray-200"
                                )}>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="Ask away..."
                                        disabled={isLoading}
                                        className={cn(
                                            "flex-1 bg-transparent border-none outline-none text-sm placeholder:text-gray-400",
                                            isLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!input.trim() || isLoading}
                                        className={cn(
                                            "p-1.5 rounded-lg transition-colors",
                                            input.trim() && !isLoading
                                                ? "bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                                                : "text-gray-300 cursor-not-allowed dark:text-gray-600"
                                        )}
                                    >
                                        {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    </button>
                                </div>
                                <button
                                    onClick={() => setActiveView('home')}
                                    className="text-xs text-center w-full text-gray-400 mt-3 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                >
                                    Cancel & Return to History
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
