import * as vscode from 'vscode';
import { existsSync } from "fs";
import { ZoteroDatabase } from './zotero';
import * as path from 'path';
import {
    BibManager,
    sortByDistance,
} from './bib';
import { writeFileFromString } from './io';
import {
    extractBibKeys,
    msgSummary,
    collectCiteKeys,
    resolveBibFile,
    getNewBibContent,
    backupBib
} from './tidy';
import {
    expandPath,
    formatAuthors,
    formatTypes,
    handleError
} from './utils';

/**
 * Initializes the Zotero database connection using the path specified in the extension settings.
 * @returns ZoteroDatabase instance
 */
export function initZoteroDb(): ZoteroDatabase {
    const config = vscode.workspace.getConfiguration('zotero');
    const zoteroDbPath = expandPath(config.get<string>('zoteroDbPath', '~/Zotero/zotero.sqlite'));
    if (!existsSync(zoteroDbPath)) {
        vscode.window.showErrorMessage(`Zotero database not found at path: ${zoteroDbPath}`);
        throw new Error(`Zotero database not found at path: ${zoteroDbPath}`);
    }
    return new ZoteroDatabase(zoteroDbPath);
}

/**
 * Executes a function that requires a ZoteroDatabase connection.
 * @param fn function that requires ZoteroDatabase connection
 */
async function withZoteroDb(
    fn: (db: ZoteroDatabase, editor: vscode.TextEditor) => Promise<void>
) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }
    const zoteroDb = initZoteroDb();
    try {
        await zoteroDb.connectIfNeeded();
        await fn(zoteroDb, editor);
    } catch (error) {
        handleError(error, 'Error occurred in Zotero command');
    } finally {
        zoteroDb.close();
    }
}

export function searchLibrary() {
    return withZoteroDb(async (zoteroDb, editor) => {
        const items = await zoteroDb.getItems();
        if (items.length === 0) {
            vscode.window.showInformationMessage('No items found in Zotero library');
            return;
        }

        const quickPickItems = items.map(item => ({
            label: `${formatTypes(item.itemType)} ${formatAuthors(item.creators)} (${item.year || 'n.d.'})`,
            description: `@${item.citeKey}`,
            detail: item.title,
            item,
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Search Zotero library',
            matchOnDescription: true,
            matchOnDetail: true,
        });

        if (selected) {
            new BibManager(editor, editor.document.languageId).updateBibFile(selected.item);
        }
    });
}

export function openItem() {
    return withZoteroDb(async (zoteroDb, editor) => {
        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /@?[\w-]+/);
        if (!wordRange) {
            vscode.window.showInformationMessage('No word found at cursor position');
            return;
        }

        const word = editor.document.getText(wordRange);
        const citeKey = word.startsWith('@') ? word.substring(1) : word;

        const openOptions = await zoteroDb.getOpenOptions(citeKey);
        if (!openOptions) { return; }
        if (openOptions.length === 0) {
            vscode.window.showInformationMessage('No PDF or DOI found for this item');
            return;
        }

        if (openOptions.length === 1) {
            openAttachment(openOptions[0]);
            return;
        }

        const labels: Record<string, string> = {
            pdf: 'Open PDF',
            doi: 'Open DOI link',
            zotero: 'Open in Zotero',
        };
        const quickPickItems = openOptions.map(option => ({
            label: labels[option.type] ?? '',
            option,
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, { placeHolder: 'Choose action' });
        if (selected) { openAttachment(selected.option); }
    });
}

function openAttachment(option: any) {
    // handle item in a group library
    // if option.groupID is present, use groups/{groupID} in the URL
    // otherwise use library for personal library
    const scope = option.groupID ? `groups/${option.groupID}` : 'library';
    const { key } = option;
    const urls: Record<string, string> = {
        doi: `https://doi.org/${key}`,
        zotero: `zotero://select/${scope}/items/${key}`,
        pdf: `zotero://open-pdf/${scope}/items/${key}`,
    };
    const url = urls[option.type];
    if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
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
        const selectedFiles = await selectFiles(editor, fileType);
        if (!selectedFiles) { return; }

        const allCiteKeys = await collectCiteKeys(selectedFiles, fileType);
        if (allCiteKeys.size === 0) {
            vscode.window.showInformationMessage('No citation keys found in selected files');
            return;
        }

        const bib = await resolveBibFile(editor, fileType);
        if (!bib) { return; }

        const { newBibContent, excluded } = await getNewBibContent(bib.bibManager, [...allCiteKeys]);
        if (!newBibContent) {
            if (excluded.length > 0) {
                vscode.window.showErrorMessage(
                    `None of ${excluded.length} key(s) could be resolved in Zotero.`
                );
            }
            return;
        }

        // if there are existing entries in the bib file, back it up before overwriting
        if (bib.previousKeys.size > 0) {
            await backupBib(bib.bibUri);
        }

        await writeFileFromString(bib.bibUri, newBibContent);

        const summary = msgSummary(bib.previousKeys, extractBibKeys(newBibContent), excluded);
        vscode.window.showInformationMessage(summary);

    } catch (error) {
        handleError(error, 'Failed to tidy bibliography');
    }
}
