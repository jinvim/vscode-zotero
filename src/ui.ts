import * as vscode from 'vscode';
import { existsSync } from "fs";
import { ZoteroDatabase } from './zotero';
import { BibManager } from './bib';
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
function initZoteroDb(): ZoteroDatabase {
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