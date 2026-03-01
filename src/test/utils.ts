import * as path from 'path';
import * as vscode from 'vscode';
import { BibManager } from '../bib';
import {
    ZoteroDatabase,
} from '../zotero';

/** resolve path for reading files in src/test/resources.test */
export function joinFixturePath(filename: string): vscode.Uri {
    const fixtureDir = path.join(__dirname, '..', '..', 'src', 'test', 'resources.test');
    return vscode.Uri.file(path.join(fixtureDir, filename));
}
// for zotero.test.ts
export function initZoteroDb(filename: string): ZoteroDatabase {
    const zoteroDbPath = joinFixturePath(filename).path;
    return new ZoteroDatabase(zoteroDbPath);
};

export async function parseJsonFile(filename: string): Promise<any> {
    const filePath = joinFixturePath(filename);
    return JSON.parse(
        await vscode.workspace.fs.readFile(filePath).then(buffer => buffer.toString())
    );
}
// for bib.test.ts
/** creates a bibmanager from content (in-memory) */
export async function makeManagerWithContent(content: string, fileType: string): Promise<BibManager> {
    const doc = await vscode.workspace.openTextDocument({ content, language: fileType });
    const editor = await vscode.window.showTextDocument(doc);
    return new BibManager(editor, fileType);
}

/** creates a bibmanager from file. */
export async function makeManagerFromFile(filename: string, fileType: string): Promise<BibManager> {
    const uri = joinFixturePath(filename);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    return new BibManager(editor, fileType);
}
