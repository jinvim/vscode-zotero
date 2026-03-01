import * as vscode from 'vscode';
import { searchLibrary, openItem } from './ui';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('zotero.searchLibrary', searchLibrary),
        vscode.commands.registerCommand('zotero.openItem', openItem),
    );
}

export function deactivate() { }