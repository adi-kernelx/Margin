// Pure fuzzy matching for the command palette.
//
// A query matches a candidate when every query character appears in the
// candidate in order. The score rewards matches that start words, runs of
// consecutive characters and an early first match, so "sp" ranks
// "Split pages" above "Export PDF".

export interface FuzzyMatch {
    score: number;
    /** Candidate indexes of the matched characters, for highlighting. */
    positions: number[];
}

const WORD_START_BONUS = 8;
const CONSECUTIVE_BONUS = 5;
const BASE_MATCH = 1;
const LEADING_GAP_PENALTY = 0.2;

function isWordStart(text: string, index: number): boolean {
    if (index === 0) return true;
    const previous = text[index - 1];
    return previous === ' ' || previous === '-' || previous === '_' || previous === '/' || previous === '.';
}

function findWordStart(haystack: string, character: string, from: number): number {
    for (let index = haystack.indexOf(character, from); index !== -1; index = haystack.indexOf(character, index + 1)) {
        if (isWordStart(haystack, index)) return index;
    }
    return -1;
}

/**
 * One left-to-right pass. With `preferWordStarts`, each character jumps to
 * its next word-start occurrence when there is one, so "p" in "Split pages"
 * lands on "pages" rather than the "p" inside "Split".
 */
function scan(needle: string, haystack: string, preferWordStarts: boolean): FuzzyMatch | null {
    const positions: number[] = [];
    let score = 0;
    let cursor = 0;
    for (const character of needle) {
        if (character === ' ') continue;
        const previous = positions[positions.length - 1];
        const continues = previous !== undefined && haystack[previous + 1] === character;
        let found = continues ? previous + 1 : -1;
        if (found === -1 && preferWordStarts) found = findWordStart(haystack, character, cursor);
        if (found === -1) found = haystack.indexOf(character, cursor);
        if (found === -1) return null;
        score += BASE_MATCH;
        if (isWordStart(haystack, found)) score += WORD_START_BONUS;
        if (positions.length && positions[positions.length - 1] === found - 1) score += CONSECUTIVE_BONUS;
        positions.push(found);
        cursor = found + 1;
    }
    score -= (positions[0] ?? 0) * LEADING_GAP_PENALTY;
    return { score, positions };
}

const SUBSTRING_BONUS = 10;

/**
 * The query typed as one contiguous run ("set" inside "Open settings") beats
 * the same letters scattered across words, and more so at a word start.
 */
function substring(needle: string, haystack: string): FuzzyMatch | null {
    const compact = needle.replace(/\s+/g, '');
    let best: FuzzyMatch | null = null;
    for (let at = haystack.indexOf(compact); at !== -1; at = haystack.indexOf(compact, at + 1)) {
        const positions = Array.from({ length: compact.length }, (_, offset) => at + offset);
        const score = compact.length * BASE_MATCH
            + (compact.length - 1) * CONSECUTIVE_BONUS
            + SUBSTRING_BONUS
            + (isWordStart(haystack, at) ? WORD_START_BONUS * 2 : 0)
            - at * LEADING_GAP_PENALTY;
        if (!best || score > best.score) best = { score, positions };
    }
    return best;
}

export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
    const needle = query.trim().toLowerCase();
    if (!needle) return { score: 0, positions: [] };
    const haystack = candidate.toLowerCase();
    const options = [substring(needle, haystack), scan(needle, haystack, true), scan(needle, haystack, false)]
        .filter((match): match is FuzzyMatch => match !== null);
    if (!options.length) return null;
    return options.reduce((best, match) => (match.score > best.score ? match : best));
}

export interface RankedItem<T> {
    item: T;
    match: FuzzyMatch;
}

/**
 * Filters and orders `items` by their best-scoring text. Ties keep the input
 * order so a registry's natural grouping survives an empty or broad query.
 */
export function fuzzyRank<T>(query: string, items: readonly T[], getText: (item: T) => string[]): RankedItem<T>[] {
    const ranked: (RankedItem<T> & { order: number })[] = [];
    items.forEach((item, order) => {
        let best: FuzzyMatch | null = null;
        for (const text of getText(item)) {
            const match = fuzzyMatch(query, text);
            if (match && (!best || match.score > best.score)) best = match;
        }
        if (best) ranked.push({ item, match: best, order });
    });
    ranked.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
    return ranked.map(({ item, match }) => ({ item, match }));
}
