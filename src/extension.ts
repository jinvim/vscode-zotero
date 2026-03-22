import * as vscode from 'vscode';
import { searchLibrary, openItem, tidyBib } from './ui';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('zotero.searchLibrary', searchLibrary),
        vscode.commands.registerCommand('zotero.openItem', openItem),
        vscode.commands.registerCommand('zotero.tidyBib', tidyBib),
    );
}

export function deactivate() { }