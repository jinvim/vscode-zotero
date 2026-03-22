import * as vscode from 'vscode';
import * as path from 'path';
import {
    handleError,
    isValidBibEntry,
    formatCiteKey,
    fileExists
} from './utils';
import {
    readFileAsString,
    writeFileFromString
} from './io';

class NotFound {
    constructor(public readonly key: string) { }
}

/**
 * class for finding, managing *.bib files, and communicating with Better BibTeX for exporting Bib(La)TeX entries
 * @param editor vscode.TextEditor instance to determine current document and workspace context.
 * @param fileType the filetype of the current document (e.g., 'bibtex', 'latex').
 */
export class BibManager {

    private translator: string;
    private editor: vscode.TextEditor;
    private fileType: string;
    private serverUrl: string;

    constructor(editor: vscode.TextEditor, fileType: string) {
        const config = vscode.workspace.getConfiguration('zotero');
        const translator = config.get<string>('betterBibtexTranslator', 'Better BibLaTeX');
        this.translator = translator;
        this.editor = editor;
        this.fileType = fileType;
        this.serverUrl = 'http://localhost:23119';
    }

    /**
     * Resolve the URI for the bibliography file
     * If the path is absolute, return as is.
     * If the path is relative, resolve URI relative to the current document.
     * @param bibFile name of bibliography file
     * @returns vscode.Uri for the bibliography file
     */
    public resolveBibUri(bibFile: string): vscode.Uri {
        // if bibFile is an absolute path, return it as is
        if (path.isAbsolute(bibFile)) {
            return vscode.Uri.file(bibFile);
        }
        // otherwise, resolve it relative to the current document
        return vscode.Uri.joinPath(this.editor.document.uri, '..', bibFile);
    }

    /**
     * send a JSON-RPC request to Better BibTeX to export the given items, and return the raw response
     * @param items 
     * @returns Response from the Better BibTeX API
     */
    private async bbtGetResponse(items: any[]): Promise<Response> {
        const url = `${this.serverUrl}/better-bibtex/json-rpc`;
        const payload = {
            jsonrpc: '2.0',
            method: 'item.export',
            params: {
                citekeys: items.map(i => i.citeKey),
                translator: this.translator,
                libraryID: items[0].libraryID
            }
        };
        return await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    /**
     * Raw JSON-RPC call to Better BibTeX.
     * @param citeKeys list of citation keys to export
     * @param libraryID optional Zotero library ID to constrain the search
     * @returns discriminated union: ok with content, notFound with the offending key, or fatal with an error message
     */
    private async bbtCall(items: any[]): Promise<string | NotFound | null> {
        try {
            const response = await this.bbtGetResponse(items);
            const json = await response.json();

            if (typeof json.result === 'string') { return json.result; }

            const errMsg: string = json.error?.message ?? '';
            if (errMsg.toLowerCase().includes('not found')) {
                return new NotFound(errMsg.match(/['"]([^'"]+)['"]/)?.[1] ?? '');
            }
            vscode.window.showErrorMessage('Cannot connect to Better BibTeX. Make sure Zotero is running!');
            return null;
        } catch {
            vscode.window.showErrorMessage('Cannot connect to Better BibTeX. Make sure Zotero is running!');
            return null;
        }
    }

    /**
     * Export a single Zotero item to Bib(La)TeX via Better BibTeX.
     * @param item Zotero item with citeKey and libraryID
     * @returns Bib(La)TeX entry string, or empty string
     */
    public async bbtExport(item: any): Promise<string> {
        const result = await this.bbtCall([item]);
        // if result is string, return as is, otherwise return empty string
        if (typeof result === 'string') { return result; }
        return '';
    }

    /**
     * Export a list of items from Better BibTeX, grouped by libraryID.
     * Retries after each "not found" result by dropping the unresolvable key.
     * @param items list of items with citeKey and optional libraryID
     * @returns content — the Bib(La)TeX string (empty signals a fatal error);
     *          excluded — keys that BBT could not resolve
     */
    public async bbtBatchExport(items: any[]): Promise<{ content: string; excluded: string[] }> {
        const excluded: string[] = [];
        const allContents: string[] = [];

        // group by libraryID so each BBT call is scoped to one library
        const byLibrary = new Map(
            [...new Set(items.map(i => i.libraryID))].map(lib => [lib, items.filter(i => i.libraryID === lib)])
        );

        // for each library, try to export all items
        // if some keys are not found, drop them and retry
        for (const [, group] of byLibrary) {
            let remaining = [...group];

            while (remaining.length > 0) {
                const result = await this.bbtCall(remaining);
                // null means there was some fatal error, so we should stop trying
                if (result === null) { return { content: '', excluded }; }

                // all keys resolved successfully, so add to allContents and break out of while loop
                if (typeof result === 'string') {
                    allContents.push(result);
                    break;
                }
                // if we get a NotFound result, drop the unresolvable key and retry with the rest
                if (result instanceof NotFound) {
                    excluded.push(result.key);
                    remaining = remaining.filter(i => i.citeKey !== result.key);
                }
            }
        }

        return { content: allContents.join('\n'), excluded };
    }

    /**
     * find biblography file based on fileType, then workspace, then asking user for path
     * @returns bibliography file path or null if not found.
     */
    public async locateBibFile(): Promise<string | null> {
        const text = this.editor.document.getText();
        let bibPath: string | null = null;

        if (['markdown', 'quarto'].includes(this.fileType)) {
            bibPath = await locateBibMd(text);
        }

        if (['latex', 'tex', 'plaintex'].includes(this.fileType)) {
            bibPath = locateBibTex(text);
        }

        // if no bib file found in document, look for in workspace or ask user
        // if still no bib file found, ask user for path to bib file 
        return bibPath ?? await locateWorkspaceBib(this.editor.document.uri) ?? await askBibFilePath();
    }

    /**
     * Update the bibliography file with a new entry.
     * @param item the zotero item to add to the bibliography.
     */
    public async updateBibFile(item: any): Promise<void> {
        const bibFile = await this.locateBibFile();
        if (!bibFile) {
            vscode.window.showErrorMessage('Error locating *.bib file');
            return;
        }

        try {
            const bibUri = this.resolveBibUri(bibFile);
            const { citeKey } = item;
            const bibContent = await ensureBibFile(bibUri);

            // if bib entry for citeKey already exists, just insert citation without updating bib file
            if (checkCiteKeyExists(citeKey, bibContent)) {
                this.insertCite(citeKey);
                return;
            }

            // get bib entry from Better BibTeX
            const bibEntry = await this.bbtExport(item);
            if (!isValidBibEntry(bibEntry)) {
                vscode.window.showErrorMessage('Invalid BibLaTeX entry. Not updating bibliography file.');
                return;
            }

            this.insertCite(citeKey);
            // append new bib entry to bibliography file (with a newline if the file is not empty)
            const newContent = bibContent + (bibContent.trim() ? '\n' : '') + bibEntry;
            await writeFileFromString(bibUri, newContent);
            // show success message with relative path to bib file for better readability
            const formattedPath = toDocRelative(this.editor.document.uri, bibUri);
            vscode.window.showInformationMessage(`Added @${citeKey} to ${formattedPath}`);
        } catch (error) {
            handleError(error, `Failed to update bibliography file`);
        }
    }

    /**
     * Insert a citation to the current document at the cursor position
     * @param citeKey citation key
     */
    private insertCite(citeKey: string) {
        // Format citation key based on file type
        const formattedCitation = formatCiteKey(citeKey, this.fileType);

        // Insert citation
        this.editor.edit(editBuilder => {
            editBuilder.insert(this.editor.selection.active, formattedCitation);
        });
    }
}

/** 
 * ask user for path to bibliography file, with default value 'references.bib'
 * @return path to bibliography file or null if user cancels input
 */
async function askBibFilePath(): Promise<string | null> {
    const bibPath = await vscode.window.showInputBox({
        prompt: 'Enter path to bibliography file (default: references.bib)',
        placeHolder: 'Path to .bib file',
        value: 'references.bib'
    });
    return bibPath || null;
}

/** 
 * Ensure that the bibliography file exists at the given URI, creating it if necessary.
 * @param bibUri vscode.Uri of the bibliography file
 * @param bibFile name of the bibliography file
 * @returns content of the bibliography file as a string
 */
async function ensureBibFile(bibUri: vscode.Uri): Promise<string> {
    if (!await fileExists(bibUri)) {
        await initBib(bibUri);
        vscode.window.showInformationMessage(`Created new bibliography file at ${bibUri.fsPath}`);
    }
    return readFileAsString(bibUri);
}


/**
 * Create an empty bibliography file at the given URI (including creating parent directories)
 * @param bibUri vscode.Uri of the bibliography file to create
 */
async function initBib(bibUri: vscode.Uri): Promise<void> {
    // Create directory if it doesn't exist (createDirectory is recursive)
    const dirUri = bibUri.with({ path: path.posix.dirname(bibUri.path) });
    await vscode.workspace.fs.createDirectory(dirUri);
    // Create empty file
    await writeFileFromString(bibUri, '');
}

/**
 * Check if a given citeKey already exists in the bibliography content.
 * @param citeKey Better BibTeX citation key to check for
 * @param bibContent content of the bibliography file
 * @returns true if citeKey exists, false otherwise
 */
export function checkCiteKeyExists(citeKey: string, bibContent: string): boolean {
    if (new RegExp(`^@.*\\{${citeKey},`, 'm').test(bibContent)) {
        vscode.window.showInformationMessage(`Entry for @${citeKey} already exists in bibliography`);
        return true;
    }
    return false;
}

// functions to locate bibliography file
/**
 * Check for biblography file in markdown/quarto documents in the YAML header
 * @param text content of current file
 * @returns bibliography file path if found, otherwise null
 */
function locateBibMdYaml(text: string): string | null {
    return text.match(/['"]?([^'"\s\[\],]+\.bib)['"]?/)?.[1] ?? null;
}

/**
 * Check for biblography file in _quarto.yml in the root of the workspace
 * @returns bibliography file path if found, otherwise null
 */
async function locateBibMdProject(): Promise<string | null> {
    const rootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!rootUri) { return null; }

    const quartoYmlUri = vscode.Uri.joinPath(rootUri, '_quarto.yml');
    if (!await fileExists(quartoYmlUri)) { return null; }

    return locateBibMdYaml(await readFileAsString(quartoYmlUri));
}

/**
 * Locate bibliography file for markdown/quarto documents by first checking YAML header,
 * then _quarto.yml in workspace.
 * @param text content of current file
 * @returns bibliography file path if found, otherwise null
 */
async function locateBibMd(text: string): Promise<string | null> {
    return locateBibMdYaml(text) ?? await locateBibMdProject();
}

/**
 * Locate bibliography file for LaTeX documents
 * @param text content of current file
 * @returns bibliography file path if found, otherwise null
 */
function locateBibTex(text: string): string | null {
    // look for \bibliography{...}
    const bib = text.match(/\\bibliography\{['"]?([^'"{}]+)['"]?\}/);
    if (bib) { return `${bib[1]}.bib`; }

    // look for \addbibresource{...}
    const biblatex = text.match(/\\addbibresource\{['"]?([^'"{}]+)['"]?\}/);
    // if it ends with .bib, return as is, otherwise append .bib
    if (biblatex) { return biblatex[1].endsWith('.bib') ? biblatex[1] : `${biblatex[1]}.bib`; }

    return null;
}

/**
 * Check for biblography file in the root of the workspace
 * @returns bibliography file path if found, otherwise null
 */
async function locateWorkspaceBib(docUri: vscode.Uri): Promise<string | null> {
    // get workspace folder for current document, or default to first workspace folder if not found
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) { return null; }

    // use RelativePattern to find all .bib files in the workspace
    const bibPattern = new vscode.RelativePattern(workspaceFolder, '**/*.bib');
    const bibUris = await vscode.workspace.findFiles(bibPattern);
    if (bibUris.length === 0) { return null; }

    // prioritize bib files closer to the current document
    const bibs = sortByDistance(bibUris, docUri)
        .map(uri => toDocRelative(docUri, uri));

    // if there are multiple bib files, prioritize 'bibliography.bib' or 'references.bib'
    // if neither of those files exist, just return the closest one
    const preferred = bibs.find(rel => ['bibliography.bib', 'references.bib'].includes(path.posix.basename(rel))) ?? bibs[0];
    return preferred;
}

/** Convert an absolute file path to a relative path from the current document
 * @param filePath absolute file path
 * @returns relative file path from the current document
 */
function toDocRelative(docUri: vscode.Uri, fileUri: vscode.Uri): string {
    const docDir = path.posix.dirname(docUri.path);
    return path.posix.relative(docDir, fileUri.path);
}

/**
 * Sort file URIs by ascending path distance from a reference document URI.
 * Prefers files that require fewer upward traversals, then fewer path segments.
 */
export function sortByDistance(uris: vscode.Uri[], refUri: vscode.Uri): vscode.Uri[] {
    const refDir = path.posix.dirname(refUri.path);
    const depth = (uri: vscode.Uri) => {
        const rel = path.posix.relative(refDir, uri.path);
        return (rel.match(/\.\.\//g) ?? []).length;
    };
    return [...uris].sort((a, b) => depth(a) - depth(b));
}