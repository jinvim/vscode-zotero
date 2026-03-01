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

export const searchLibrary = vscode.commands.registerCommand('zotero.searchLibrary', async () => {
    // initialize configuration
    const zoteroDb = initZoteroDb();

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }
    const fileType = editor.document.languageId;

    try {
        // Connect to database
        await zoteroDb.connectIfNeeded();

        // Get items from Zotero
        const items = await zoteroDb.getItems();

        if (items.length === 0) {
            vscode.window.showInformationMessage('No items found in Zotero library');
            return;
        }

        // Create QuickPick items
        const quickPickItems = items.map(item => {
            const creators = item.creators;
            const authors = formatAuthors(creators);

            // determine icon based on item type
            const icon = formatTypes(item.itemType);

            return {
                label: `${icon} ${authors} (${item.year || 'n.d.'})`,
                description: `@${item.citeKey}`,
                item: item,
                detail: item.title
            };
        });

        // Show QuickPick
        let selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Search Zotero library',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            const bibManager = new BibManager(editor, fileType);
            bibManager.updateBibFile(selected.item);
        }
    } catch (error) {
        handleError(error, `Error occurred while searching Zotero library`);
    } finally {
        zoteroDb.close();
    }
});

export const openItem = vscode.commands.registerCommand('zotero.openItem', async () => {
    // initialize configuration
    const zoteroDb = initZoteroDb();

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }
    const fileType = editor.document.languageId;

    try {
        // Connect to database
        await zoteroDb.connectIfNeeded();

        // Get the current position and word under cursor
        const position = editor.selection.active;
        const document = editor.document;
        // regex to match citation keys with hypehens
        const wordRange = document.getWordRangeAtPosition(position, /@?[\w-]+/);

        if (!wordRange) {
            vscode.window.showInformationMessage('No word found at cursor position');
            return;
        }

        const word = document.getText(wordRange);

        let citeKey = word;
        // extract citation key (remove the @ symbol)
        if (citeKey.startsWith('@')) {
            citeKey = citeKey.substring(1);
        }

        const openOptions = await zoteroDb.getOpenOptions(citeKey);
        if (!openOptions) {
            return;
        }

        if (openOptions.length === 0) {
            vscode.window.showInformationMessage(`No PDF or DOI found for this item`);
            return;
        }
        if (openOptions.length === 1) {
            openAttachment(openOptions[0]);
        } else {
            // Show QuickPick for multiple options
            const quickPickItems = openOptions.map((option, index) => ({
                label: option.type === 'pdf' ? 'Open PDF' :
                    option.type === 'doi' ? 'Open DOI link' :
                        option.type === 'zotero' ? 'Open in Zotero' : '',
                option: option,
                index: index
            }));

            const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Choose action'
            });

            if (selectedItem) {
                openAttachment(selectedItem.option);
            }
        }
    } catch (error) {
        handleError(error, `Error occurred while opening Zotero item`);
    } finally {
        zoteroDb.close();
    }
});

function openAttachment(option: any): void {
    switch (option.type) {
        case 'doi':
            vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${option.key}`));
            break;
        case 'zotero':
            if (option.groupID) {
                vscode.env.openExternal(vscode.Uri.parse(`zotero://select/groups/${option.groupID}/items/${option.key}`));
                break;
            }
            vscode.env.openExternal(vscode.Uri.parse(`zotero://select/library/items/${option.key}`));
            break;
        case 'pdf':
            if (option.groupID) {
                vscode.env.openExternal(vscode.Uri.parse(`zotero://open-pdf/groups/${option.groupID}/items/${option.key}`));
                break;
            }
            vscode.env.openExternal(vscode.Uri.parse(`zotero://open-pdf/library/items/${option.key}`));
            break;
        default:
            break;
    }
}

function initZoteroDb(): ZoteroDatabase {
    const config = vscode.workspace.getConfiguration('zotero');
    let zoteroDbPath = config.get<string>('zoteroDbPath', '~/Zotero/zotero.sqlite');
    zoteroDbPath = expandPath(zoteroDbPath);

    const zoteroDbExists = existsSync(zoteroDbPath);

    if (!zoteroDbExists) {
        vscode.window.showErrorMessage(`Zotero database not found at path: ${zoteroDbPath}`);
        throw new Error(`Zotero database not found at path: ${zoteroDbPath}`);
    }

    return new ZoteroDatabase(zoteroDbPath);
}