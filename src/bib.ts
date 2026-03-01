import * as vscode from 'vscode';
import * as path from 'path';
import {
    handleError,
    isValidBibEntry,
    formatCitation,
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

    private resolveBibUri(bibFile: string): vscode.Uri {
        // if bibFile is an absolute path, return it as is
        if (path.isAbsolute(bibFile)) {
            return vscode.Uri.file(bibFile);
        }
        // otherwise, resolve it relative to the current document
        return vscode.Uri.joinPath(this.editor.document.uri, '..', bibFile);
    }

    /**
     * get Bib(La)TeX entry using Better BibTeX json-rpc
     * @param item the zotero item to convert.
     * @returns Bib(La)TeX entry.
     */
    public async bbtExport(
        item: any
    ): Promise<string> {
        const url = `${this.serverUrl}/better-bibtex/json-rpc`;

        const payload = {
            jsonrpc: '2.0',
            method: 'item.export',
            params: {
                citekeys: [item.citeKey],
                translator: this.translator,
                libraryID: item.libraryID
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(payload),
            });
            const json = await response.json();

            // Handle JSON-RPC errors
            if (json.error) {
                if (json.error.code === -32603) {
                    vscode.window.showErrorMessage(`Cannot connect to Better BibTeX. Make sure Zotero window is open!`);
                    return '';
                }
                vscode.window.showErrorMessage(`Better BibTeX error: ${json.error.message || 'Unknown error'}`);
                return '';
            }

            // Ensure result is a string
            if (typeof json.result !== 'string') {
                vscode.window.showErrorMessage('Better BibTeX returned invalid result format');
                return '';
            }

            return json.result;

        } catch (error) {
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
        return bibPath ?? await locateWorkspaceBib() ?? await askBibFilePath();
    }

    public async updateBibFile(item: any): Promise<void> {
        const bibFile = await this.locateBibFile();
        if (!bibFile) {
            vscode.window.showErrorMessage('Error locating *.bib file');
            return;
        }

        try {
            const bibUri = this.resolveBibUri(bibFile);
            const citeKey = item.citeKey;

            // Check if file exists, if not, create it
            if (!await fileExists(bibUri)) {
                await initBib(bibUri);
                vscode.window.showInformationMessage(`Created new bibliography file at ${bibFile}`);
            }

            const bibContent = await readFileAsString(bibUri);
            if (checkCiteKeyExists(citeKey, bibContent)) {
                this.insertCite(item);
                return;
            }

            // Get BibTeX entry
            const bibEntry = await this.bbtExport(item);
            // if bibEntry is empty or undefined, return (probably could not connect to BBT server)
            if (!bibEntry || bibEntry.trim() === '') {
                return;
            }

            // check if bibEntry is valid
            if (!isValidBibEntry(bibEntry)) {
                vscode.window.showErrorMessage('Invalid BibLaTeX entry. Not updating bibliography file.');
                return;
            }

            this.insertCite(item);

            // Add empty line before new entry if file is not empty
            const needsEmptyLine = bibContent.trim().length > 0 && !bibContent.trim().endsWith('\n');
            const newContent = bibContent + (needsEmptyLine ? '\n' : '') + bibEntry;

            // Write updated content
            await writeFileFromString(bibUri, newContent);
            vscode.window.showInformationMessage(`Added @${citeKey} to ${bibFile}`);
        } catch (error) {
            handleError(error, `Failed to update bibliography file`);
        }
    }

    private insertCite(item: any) {
        // Format citation key based on file type
        const citeKey = item.citeKey;
        let formattedCitation = formatCitation(citeKey, this.fileType);

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
async function locateWorkspaceBib(): Promise<string | null> {
    // first, check if root workspace exists
    const rootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (!rootUri) { return null; }

    for (const candidate of ['bibliography.bib', 'references.bib']) {
        if (await fileExists(vscode.Uri.joinPath(rootUri, candidate))) {
            return candidate;
        }
    }

    const entries = await vscode.workspace.fs.readDirectory(rootUri);
    const bibEntry = entries.find(([name, type]) => name.endsWith('.bib') && type === vscode.FileType.File);
    return bibEntry?.[0] ?? null;
}