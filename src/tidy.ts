import * as vscode from 'vscode';
import {
    BibManager,
    ensureBibFile
} from './bib';
import { readFileAsString, writeFileFromString } from './io';
import { initZoteroDb } from './ui';


function parseTexKeys(content: string): Set<string> {
    const keys = new Set<string>();
    // find any \cite command, case-insensitive (covers \Cites, \Parencite, etc.)
    // excludes \nocite
    const cmdRegex = /\\(?!nocite)[a-z]*cite[a-z]*\*?/gi;
    let m;
    while ((m = cmdRegex.exec(content)) !== null) {
        // match one or more ([opt]){key} groups that follow the cite command
        const after = content.slice(m.index + m[0].length);
        const seq = after.match(/^(\s*(\[[^\]]*\])?\s*\{[^}]*\})+/);
        if (!seq) { continue; }
        // extract keys from every {...} in the sequence
        const braceRegex = /\{([^}]*)\}/g;
        let b;
        while ((b = braceRegex.exec(seq[0])) !== null) {
            // split by comma
            for (const key of b[1].split(',')) {
                const trimmed = key.trim();
                if (trimmed && trimmed !== '*') { keys.add(trimmed); }
            }
        }
    }
    return keys;
}

function parseMarkdownKeys(content: string): Set<string> {
    const keys = new Set<string>();
    // Markdown/Quarto: @citekey — key may contain letters, digits, underscores, hyphens, colons.
    // Negative lookbehind (?<!\w) prevents matching @-signs inside email addresses (user@domain).
    const citeRegex = /(?<!\w)@([\w][\w:-]*)/g;

    // Reserved prefixes for cross-references (must not be treated as cite keys)
    const excludePrefixes = new Set([
        'fig', 'tbl', 'lst', 'tip', 'nte', 'wrn', 'imp', 'cau',
        'thm', 'lem', 'cor', 'prp', 'cnj', 'def', 'exm', 'exr',
        'sol', 'rem', 'alg', 'eq', 'sec', 'apx'
    ]);

    let match;
    while ((match = citeRegex.exec(content)) !== null) {
        const key = match[1];
        const prefix = key.split('-')[0];
        if (!excludePrefixes.has(prefix)) {
            keys.add(key);
        }
    }
    return keys;
}


/**
 * Parse cite keys from file content based on file type.
 * For LaTeX: matches all \cite variants (e.g. \citep, \citet, \citeauthor).
 * For Markdown/Quarto: matches @key syntax, excluding reserved Quarto cross-reference prefixes.
 */
export function parseCiteKeys(content: string, fileType: string): Set<string> {
    switch (fileType) {
        case 'latex':
        case 'tex':
        case 'plaintex':
            return parseTexKeys(content);
        case 'markdown':
        case 'quarto':
            return parseMarkdownKeys(content);
        default:
            return new Set<string>();
    }
}

/**
 * Extract all cite keys from a .bib file content by scanning @TYPE{key, patterns.
 */
export function extractBibKeys(bibContent: string): Set<string> {
    const keys = new Set<string>();
    const entryRegex = /^@\w+\s*\{([^,]+),/gm;
    let match;
    while ((match = entryRegex.exec(bibContent)) !== null) {
        keys.add(match[1].trim());
    }
    return keys;
}


export async function collectCiteKeys(selectedFiles: vscode.Uri[], fileType: string): Promise<Set<string>> {
    const allCiteKeys = new Set<string>();
    for (const fileUri of selectedFiles) {
        const content = await readFileAsString(fileUri);
        for (const key of parseCiteKeys(content, fileType)) {
            allCiteKeys.add(key);
        }
    }
    return allCiteKeys;
}

export async function resolveBibFile(
    editor: vscode.TextEditor, fileType: string
): Promise<{ bibManager: BibManager; bibUri: vscode.Uri; previousKeys: Set<string> } | null> {
    const bibManager = new BibManager(editor, fileType);
    const bibFile = await bibManager.locateBibFile();
    if (!bibFile) {
        vscode.window.showErrorMessage('Error locating *.bib file');
        return null;
    }
    const bibUri = bibManager.resolveBibUri(bibFile);
    const previousKeys = extractBibKeys(await ensureBibFile(bibUri));
    return { bibManager, bibUri, previousKeys };
}

export async function getNewBibContent(
    bibManager: BibManager, citeKeys: string[]
): Promise<{ newBibContent: string | null; excluded: string[] }> {
    const zoteroDb = initZoteroDb();
    await zoteroDb.connectIfNeeded();
    const { resolved, excluded: dbExcluded } = await zoteroDb.resolveItems(citeKeys);
    zoteroDb.close();

    const { content: newBibContent, excluded: bbtExcluded } = await bibManager.bbtBatchExport(resolved);
    return { newBibContent, excluded: [...dbExcluded, ...bbtExcluded] };
}

export function msgSummary(previousKeys: Set<string>, newKeys: Set<string>, excluded: string[]): string {
    const added = [...newKeys].filter(k => !previousKeys.has(k));
    const removed = [...previousKeys].filter(k => !newKeys.has(k));

    const parts: string[] = [];
    if (added.length > 0) { parts.push(`+${added.length} added`); }
    if (removed.length > 0) { parts.push(`-${removed.length} removed`); }
    if (excluded.length > 0) { parts.push(`${excluded.length} key(s) not found in Zotero: ${excluded.join(', ')}`); }

    return parts.length > 0
        ? `Bibliography refreshed: ${parts.join('. ')}.`
        : 'Bibliography is already up to date.';
}


export async function backupBib(bibUri: vscode.Uri): Promise<void> {
    const bakUri = bibUri.with({ path: bibUri.path + '.bak' });
    const currentContent = await readFileAsString(bibUri);
    await writeFileFromString(bakUri, currentContent);
}