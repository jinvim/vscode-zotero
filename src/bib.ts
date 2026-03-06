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
    private resolveBibUri(bibFile: string): vscode.Uri {
        // if bibFile is an absolute path, return it as is
        if (path.isAbsolute(bibFile)) {
            return vscode.Uri.file(bibFile);
        }
        // otherwise, resolve it relative to the current document
        return vscode.Uri.joinPath(this.editor.document.uri, '..', bibFile);
    }
    
    /**
     * Parse the response from Better BibTeX JSON-RPC call
     * @param json JSON response
     * @returns Bib(La)TeX entry if successful, otherwise empty string and shows error message
     */
    private parseBbtResponse(json: any): string {
        if (json.error) {
            const msg = json.error.code === -32603
                ? 'Cannot connect to Better BibTeX. Make sure Zotero window is open!'
                : `Better BibTeX error: ${json.error.message || 'Unknown error'}`;
            vscode.window.showErrorMessage(msg);
            return '';
        }
        if (typeof json.result !== 'string') {
            vscode.window.showErrorMessage('Better BibTeX returned invalid result format');
            return '';
        }
        return json.result;
    }

    /**
     * get Bib(La)TeX entry using Better BibTeX json-rpc
     * @param item the zotero item to convert.
     * @returns Bib(La)TeX entry.
     */
    public async bbtExport(item: any): Promise<string> {
        const url = `${this.serverUrl}/better-bibtex/json-rpc`;
        const payload = {
            jsonrpc: '2.0',
            method: 'item.export',
            params: { citekeys: [item.citeKey], translator: this.translator, libraryID: item.libraryID }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload),
            });
            return this.parseBbtResponse(await response.json());
        } catch {
            vscode.window.showErrorMessage('Cannot connect to Better BibTeX. Make sure Zotero is running!');
            return '';
        }
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

    // then sort bib files by their depth
    // prioritize bib files closer to the current document
    const depth = (rel: string) => (rel.match(/\.\.\//g) ?? []).length;
    const bibs = bibUris
        .map(uri => toDocRelative(docUri, uri))
        .sort((a, b) => depth(a) - depth(b));

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
