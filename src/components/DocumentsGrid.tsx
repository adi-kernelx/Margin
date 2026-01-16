import type { DocumentEntry } from '@/types';
import { DocumentPane } from './DocumentPane';
import './grid-presets.css';

interface DocumentsGridProps {
    documents: DocumentEntry[];
    layout: number;
    replicateToolbar: boolean;
}

export function DocumentsGrid({ documents, layout, replicateToolbar }: DocumentsGridProps) {
    const gridClass = `grid-layout layout-${layout}`;

    return (
        <main className="flex-1 p-3 box-border overflow-hidden bg-gray-100 dark:bg-gray-950 h-screen">
            <div className={gridClass}>
                {documents.map((doc) => (
                    <DocumentPane
                        key={doc.id}
                        doc={doc}
                        replicateToolbar={replicateToolbar}
                    />
                ))}
            </div>
        </main>
    );
}
