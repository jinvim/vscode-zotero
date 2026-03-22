import * as vscode from 'vscode';
import * as path from 'path';
import {
    BibManager,
    sortByDistance,
    ensureBibFile
} from './bib';
import { readFileAsString, writeFileFromString } from './io';
import { handleError } from './utils';
import { initZoteroDb } from './ui';


function parseTexKeys(content: string): Set<string> {
    const keys = new Set<string>();
    // Matches: \cite{key}, \citep[opt]{key}, \citet{key1,key2}, etc.
    const citeRegex = /\\cite\w*\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    let match;
    while ((match = citeRegex.exec(content)) !== null) {
        for (const key of match[1].split(',')) {
            const trimmed = key.trim();
            if (trimmed) { keys.add(trimmed); }
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

/**
 * Prompt the user to select which files to scan for citation keys.
 * - If only one file exists, returns it immediately.
 * - If multiple exist, first asks whether to use the current file only,
 *   then (if not) shows a multi-select list sorted by path proximity.
 * @returns array of selected file URIs, or null if the user cancelled.
 */
async function selectFiles(editor: vscode.TextEditor, fileType: string): Promise<vscode.Uri[] | null> {
    let globPattern = '';

    switch (fileType) {
        case 'latex':
        case 'tex':
        case 'plaintex':
            globPattern = '**/*.tex';
            break;
        case 'markdown':
            globPattern = '**/*.md';
            break;
        case 'quarto':
            globPattern = '**/*.qmd';
            break;
        default:
            return null;
    }

    const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(editor.document.uri) ??
        vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return null;
    }

    const pattern = new vscode.RelativePattern(workspaceFolder, globPattern);
    const allFiles = await vscode.workspace.findFiles(pattern);
    if (allFiles.length === 0) {
        vscode.window.showErrorMessage(`No matching files found in workspace`);
        return null;
    }

    if (allFiles.length === 1) {
        return allFiles;
    }

    // Multiple files: ask whether to use only the current file
    const choice = await vscode.window.showQuickPick(
        ['Current file only', 'Select files to include'],
        { placeHolder: 'Which files should be scanned for citations?' }
    );
    if (!choice) { return null; }
    if (choice === 'Current file only') { return [editor.document.uri]; }

    // Show checkbox list sorted by distance from current file
    const sorted = sortByDistance(allFiles, editor.document.uri);
    const currentFsPath = editor.document.uri.fsPath;
    const items = sorted.map(uri => ({
        label: path.posix.relative(workspaceFolder.uri.path, uri.path),
        description: uri.fsPath === currentFsPath ? '(current)' : undefined,
        uri,
        picked: uri.fsPath === currentFsPath,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select files to scan for citations',
        canPickMany: true,
    });
    if (!selected || selected.length === 0) { return null; }
    return selected.map(item => item.uri);
}


/**
 * Refresh the bibliography file by:
 * 1. Scanning selected source files for all citation keys.
 * 2. Exporting exactly those entries from Better BibTeX.
 * 3. Overwriting the existing .bib file with the fresh export.
 * 4. Reporting how many entries were added, removed, or not found in Zotero.
 */
export async function tidyBib(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const fileType = editor.document.languageId;
    if (!(['latex', 'tex', 'plaintex', 'markdown', 'quarto'].includes(fileType))) {
        vscode.window.showErrorMessage(
            `Unsupported file type: ${fileType}. Only LaTeX, Markdown, and Quarto files are supported.`
        );
        return;
    }

    try {
        // Step 1: Select files to parse
        const selectedFiles = await selectFiles(editor, fileType);
        if (!selectedFiles) { return; }

        // Step 2: Collect all cite keys from selected files
        const allCiteKeys = new Set<string>();
        for (const fileUri of selectedFiles) {
            const content = await readFileAsString(fileUri);
            for (const key of parseCiteKeys(content, fileType)) {
                allCiteKeys.add(key);
            }
        }

        if (allCiteKeys.size === 0) {
            vscode.window.showInformationMessage('No citation keys found in selected files');
            return;
        }

        // Step 3: Locate the .bib file
        const bibManager = new BibManager(editor, fileType);
        const bibFile = await bibManager.locateBibFile();
        if (!bibFile) {
            vscode.window.showErrorMessage('Error locating *.bib file');
            return;
        }
        const bibUri = bibManager.resolveBibUri(bibFile);

        // Step 4: Read existing .bib file to compare later
        const currentBibContent = await ensureBibFile(bibUri);
        const previousKeys = extractBibKeys(currentBibContent);

        // Step 5: Resolve cite keys to Zotero items via the database (handles multi-library disambiguation)
        const zoteroDb = initZoteroDb();
        await zoteroDb.connectIfNeeded();
        const { resolved, excluded: dbExcluded } = await zoteroDb.resolveItems([...allCiteKeys]);
        zoteroDb.close();

        // Step 6: Export resolved items from Better BibTeX
        const { content: newBibContent, excluded: bbtExcluded } = await bibManager.bbtBatchExport(resolved);
        console.log(newBibContent);
        const excluded = [...dbExcluded, ...bbtExcluded];

        // null newBibContents means fatal error during export
        if (!newBibContent) {
            if (excluded.length > 0) {
                vscode.window.showErrorMessage(
                    `None of ${excluded.length} key(s) could not be resolved in Zotero.`
                );
            }
            return;
        }

        // Step 7: Write the refreshed .bib file
        await writeFileFromString(bibUri, newBibContent);

        // Step 8: Build and show a summary of changes
        const newKeys = extractBibKeys(newBibContent);
        const added = [...newKeys].filter(k => !previousKeys.has(k));
        const removed = [...previousKeys].filter(k => !newKeys.has(k));

        const parts: string[] = [];
        if (added.length > 0) { parts.push(`+${added.length} added`); }
        if (removed.length > 0) { parts.push(`-${removed.length} removed`); }
        if (excluded.length > 0) { parts.push(`${excluded.length} key(s) not found in Zotero: ${excluded.join(', ')}`); }

        const summary = parts.length > 0
            ? `Bibliography refreshed: ${parts.join('. ')}.`
            : 'Bibliography is already up to date.';
        vscode.window.showInformationMessage(summary);

    } catch (error) {
        handleError(error, 'Failed to refresh bibliography');
    }
}
