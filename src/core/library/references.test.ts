import { describe, expect, it } from 'vitest';
import { buildFolderBreadcrumbs, createFileIdentity, normalizeLibraryName } from './references';

describe('library references', () => {
    it('builds the same identity from equivalent file metadata', () => {
        expect(createFileIdentity({ name: 'paper.pdf', size: 42, lastModified: 7 }))
            .toBe(createFileIdentity({ name: 'paper.pdf', size: 42, lastModified: 7 }));
    });

    it('distinguishes a replacement with a different modification time', () => {
        expect(createFileIdentity({ name: 'paper.pdf', size: 42, lastModified: 7 }))
            .not.toBe(createFileIdentity({ name: 'paper.pdf', size: 42, lastModified: 8 }));
    });

    it('builds root-to-current breadcrumbs', () => {
        const folders = [
            { id: 'root', name: 'Library', parentFolderId: null },
            { id: 'course', name: 'MA4106', parentFolderId: 'root' },
            { id: 'week', name: 'Week 1', parentFolderId: 'course' },
        ];
        expect(buildFolderBreadcrumbs(folders, 'week').map(folder => folder.id))
            .toEqual(['root', 'course', 'week']);
    });

    it('terminates safely when corrupt folder data contains a cycle', () => {
        const folders = [
            { id: 'a', name: 'A', parentFolderId: 'b' },
            { id: 'b', name: 'B', parentFolderId: 'a' },
        ];
        expect(buildFolderBreadcrumbs(folders, 'a')).toHaveLength(2);
    });

    it('normalizes names without changing their words', () => {
        expect(normalizeLibraryName('  Research   papers  ')).toBe('Research papers');
    });
});
