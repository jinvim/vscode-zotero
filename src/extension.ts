import * as vscode from 'vscode';
import { searchLibrary, openItem, quickOpenItem, tidyBib } from './ui';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('zotero.searchLibrary', searchLibrary),
        vscode.commands.registerCommand('zotero.openItem', quickOpenItem),
        vscode.commands.registerCommand('zotero.openItemZotero', () => openItem('zotero')),
        vscode.commands.registerCommand('zotero.openItemPdf', () => openItem('pdf')),
        vscode.commands.registerCommand('zotero.openItemDoi', () => openItem('doi')),
        vscode.commands.registerCommand('zotero.tidyBib', tidyBib),
    );
}

export function deactivate() { }