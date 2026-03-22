import * as vscode from 'vscode';
import { searchLibrary, openItem } from './ui';
import { tidyBib } from './tidy';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('zotero.searchLibrary', searchLibrary),
        vscode.commands.registerCommand('zotero.openItem', openItem),
        vscode.commands.registerCommand('zotero.tidyBib', tidyBib),
    );
}

export function deactivate() { }