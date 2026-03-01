import * as vscode from 'vscode';
import {
    searchLibrary,
    openItem
} from './ui';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(searchLibrary);
    context.subscriptions.push(openItem);
}

export function deactivate() { }