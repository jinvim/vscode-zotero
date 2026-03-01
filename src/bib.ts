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


    public async locateBibFile(): Promise<string | null> {
        const text = this.editor.document.getText();

        let bibPath: string | null = null;

        switch (this.fileType) {
            case 'markdown':
            case 'quarto':
                bibPath = await locateBibMd(text);
                break;
            case 'latex':
            case 'tex':
            case 'plaintex':
                bibPath = await locateBibTex(text);
                break;
            default:
                bibPath = await locateWorkspaceBib();
        }
        
        // if no bib file found in document, try to find in workspace
        if (!bibPath) {
            bibPath = await locateWorkspaceBib();
        }
        // if no bibliography found, ask user
        if (!bibPath) {
            bibPath = await vscode.window.showInputBox({
                prompt: 'Bibliography file not found. Please enter path to bibliography file (default: references.bib)',
                placeHolder: 'Path to .bib file',
                value: 'references.bib'
            }) || null;
        }

        return bibPath;
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

            // Check if file exists
            if (!await fileExists(bibUri)) {
                // Create directory if it doesn't exist (createDirectory is recursive)
                const dirUri = bibUri.with({ path: path.posix.dirname(bibUri.path) });
                await vscode.workspace.fs.createDirectory(dirUri);
                // Create empty file
                await writeFileFromString(bibUri, '');
                vscode.window.showInformationMessage(`Created new bibliography file at ${bibFile}`);
            }

            const bibContent = await readFileAsString(bibUri);
            if (await checkCiteKeyExists(citeKey, bibContent)) {
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


export async function checkCiteKeyExists(citeKey: string, bibContent: string): Promise<boolean> {
    const lines = bibContent.split('\n');

    // Check if entry already exists
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(new RegExp(`^@.*{${citeKey},`))) {
            vscode.window.showInformationMessage(`Entry for @${citeKey} already exists in bibliography`);
            return true;
        }
    }
    return false;
}

// function to locate bibliography file
async function locateBibMdYaml(text: string): Promise<string | null> {
    // parse any *.bib file from YAML string
    const match = text.match(/['"]?([^'"\s\[\],]+\.bib)['"]?/);
    if (match) {
        return match[1];
    }
    return null;
}

async function locateBibMdProject(): Promise<string | null> {
    // Check for _quarto.yml in project root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const quartoYmlUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '_quarto.yml');
        if (await fileExists(quartoYmlUri)) {
            const quartoYml = await readFileAsString(quartoYmlUri);
            return await locateBibMdYaml(quartoYml);
        }
    }
    return null;
}

async function locateBibMd(text: string): Promise<string | null> {
    const headerResult = await locateBibMdYaml(text);
    if (headerResult) {
        return headerResult;
    }
    const projectResult = await locateBibMdProject();
    if (projectResult) {
        return projectResult;
    }
    return null;
}

async function locateBibTex(text: string): Promise<string | null> {
    // Look for \bibliography or \addbibresource
    const bibMatch = text.match(/\\bibliography\{['"]?([^'"{}]+)['"]?\}/);
    if (bibMatch) {
        return `${bibMatch[1]}.bib`;
    }

    const biblatexMatch = text.match(/\\addbibresource\{['"]?([^'"{}]+)['"]?\}/);
    if (biblatexMatch) {
        let bibFile = biblatexMatch[1];
        if (!bibFile.endsWith('.bib')) {
            bibFile += '.bib';
        }
        return bibFile;
    }
    return null;
}

async function locateWorkspaceBib(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }
    const rootUri = workspaceFolders[0].uri;
    const candidates = ['bibliography.bib', 'references.bib'];
    for (const candidate of candidates) {
        const candidateUri = vscode.Uri.joinPath(rootUri, candidate);
        if (await fileExists(candidateUri)) {
            return candidate;
        }
    }
    const entries = await vscode.workspace.fs.readDirectory(rootUri);
    for (const [name, type] of entries) {
        if (name.endsWith('.bib') && type === vscode.FileType.File) {
            return name;
        }
    }
    return null;
}