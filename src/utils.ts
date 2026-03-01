// helper functions
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export function expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}

export function formatAuthors(creators: any[]): string {
    let authors = creators.filter(creator => creator.creatorType === 'author');
    if (authors.length === 0) {
        // if no authors, try editors (e.g., for edited volumes)
        authors = creators.filter(creator => creator.creatorType === 'editor');
    }

    switch (authors.length) {
        case 0:
            return 'NA';
        case 1:
            return `${authors[0].lastName}`;
        case 2:
            return `${authors[0].lastName} & ${authors[1].lastName}`;
        default:
            return `${authors[0].lastName} et al.`;
    }
}

export function extractYear(date: string): string | null{
    const match = date.match(/(\d{4})/);
    return match ? match[1] : null;
}

export function extractDate(date: string): string | null {
    const match = date.match(/(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

export function formatCitation(citeKey: string, fileType: string): string {
    switch (fileType) {
        case 'latex':
        case 'tex':
        case 'plaintex':
            // return `\\cite{${citeKey}}`;
            return `${citeKey}`; // just return the citkey for TeX files
        case 'markdown':
        case 'quarto':
            return `@${citeKey}`;
        default:
            return `@${citeKey}`;
    }
}

export function formatTypes(itemType: string): string {
    switch (itemType) {
        case 'book':
            return '📘';
        case 'bookSection':
            return '📖';
        case 'journalArticle':
            return '📄';
        case 'thesis':
            return '🎓';
        case 'preprint':
            return '📝';
        case 'webpage':
            return '🌏';
        default:
            return '📎';
    }
}

export function handleError(error: any, message: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
}

// Validate if content is a proper Bib(La)Tex Entry
export function isValidBibEntry(content: string): boolean {
    // Basic validation checks
    if (!content || content.trim().length === 0) {
        return false;
    }

    // Check for BibLaTeX entry patterns
    const bibEntryPattern = /@\w+\s*\{[^,]+,/;
    if (!bibEntryPattern.test(content)) {
        return false;
    }

    return true;
}