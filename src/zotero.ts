import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import initSqlJs, { Database } from 'sql.js';
import {
    queryItems,
    queryZoteroKeys,
    queryOpenOptions
} from './queries';
import {
    handleError,
    extractYear,
    formatTypes
} from './utils';

/**
 * class for managing Zotero database connection and queries
 * @param zoteroDbPath absolute path to zotero.sqlite database file
 */
export class ZoteroDatabase {
    private zoteroDbPath: string;
    private db: Database | null = null;

    constructor(zoteroDbPath: string) {
        this.zoteroDbPath = zoteroDbPath;
    }

    /**
     * connect to zotero 
     */
    public async connect() {
        try {
            const SQL = await initSqlJs();
            const zoteroDbFile = await fs.readFile(this.zoteroDbPath);
            this.db = new SQL.Database(zoteroDbFile);
        } catch (error) {
            handleError(error, `Failed to connect to databases at ${this.zoteroDbPath}`);
        }
    }

    /**
     * connects to the database if not already connected. shows an error message on failure.
     */
    public async connectIfNeeded() {
        if (this.isConnected()) {
            return;
        }
        await this.connect();
    }

    /**
     * returns whether the database connection is currently active.
     * @returns true if connected, false otherwise
     */
    public isConnected(): boolean {
        return this.db !== null;
    }

    /**
     * Get items from Zotero library
     * @returns an array of zotero items if successful, otherwise an empty array
     */
    public async getItems(): Promise<any[]> {
        if (!this.db) {
            vscode.window.showErrorMessage('Database not connected');
            return [];
        }

        try {
            const itemRows = this.getValues(this.db.exec(queryItems));
            return itemRows.map(({ creators, date, ...rest }) => ({
                ...rest,
                date,
                year: extractYear(date || ''),
                creators: (JSON.parse(creators) as any[])
                    .sort((a, b) => a.orderIndex - b.orderIndex)
            }));
        } catch (error) {
            handleError(error, `Error querying database`);
            return [];
        }
    }

    /**
     * resolves open options (zotero item, pdf attachment, doi) for a given citeKey.
     * Prompts the user to pick if multiple items match the citeKey.
     * @param citeKey Better BibTeX cite key to look up
     * @returns An array of open options, or null if the item could not be resolved
     */
    public async getOpenOptions(citeKey: string): Promise<any[] | null> {
        if (!this.db) {
            vscode.window.showErrorMessage('Database not connected');
            return null;
        }

        const matches = this.getValues(this.db.exec(queryZoteroKeys([citeKey])));
        console.log(matches);
        if (matches.length === 0) {
            vscode.window.showErrorMessage(`Could not find Zotero item for ${citeKey}`);
            return null;
        }

        // handle possible multiple zotero items with the same citeKey
        const item = await this.pickItem(citeKey, matches);
        if (!item) { return null; }

        // query open options for the selected item
        const openOptions = this.getFirstValue(
            this.db.exec(queryOpenOptions(item.zoteroKey, item.libraryID))
        );
        if (!openOptions) { return null; }
        const { groupID, pdfKey, doi } = openOptions;

        const options: any[] = [{ type: 'zotero', key: item.zoteroKey, groupID }];
        if (pdfKey) { options.push({ type: 'pdf', key: pdfKey, groupID }); }
        if (doi) { options.push({ type: 'doi', key: doi }); }

        return options;
    }

    /**
     * this function is called to handle possibility of multiple zotero items with the same citeKey
     * if there is only one match, it is returned
     * if there are multiple matches the user is prompted to select one
     * @param citeKey the citeKey being resolved
     * @param matches the list of zotero items matching the citeKey
     * @returns the single resolved item, or null if the user cancels the picker
     */
    private async pickItem(citeKey: string, matches: any[]): Promise<any | null> {
        if (matches.length === 0) { return null; }
        if (matches.length === 1) { return matches[0]; }

        const quickPickItems = matches.map(m => ({
            label: `${formatTypes(m.typeName)} ${m.title}`,
            detail: m.libraryName || 'My Library',
            item: m,
        }));
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: `Multiple items found for @${citeKey}. Please select one:`,
            matchOnDetail: true,
        });
        return selected?.item ?? null;
    }

    /**
     * resolves a list of cite keys to zotero items
     * @param citeKeys list of cite keys to resolve
     * @returns resolved items and cite keys not found in the database
     */
    public async resolveItems(citeKeys: string[]): 
        Promise<{ resolved: any[]; excluded: string[] }> 
    {
        if (!this.db) {
            vscode.window.showErrorMessage('Database not connected');
            return { resolved: [], excluded: [...citeKeys] };
        }

        const items = this.getValues(this.db.exec(queryZoteroKeys(citeKeys)));

        // group items by citeKey to handle possible multiple items with the same citeKey
        const byKey = new Map<string, any[]>();
        for (const item of items) {
            if (!byKey.has(item.citeKey)) { byKey.set(item.citeKey, []); }
            byKey.get(item.citeKey)!.push(item);
        }

        const resolved: any[] = [];
        const excluded: string[] = [];

        for (const citeKey of citeKeys) {
            const item = await this.pickItem(citeKey, byKey.get(citeKey) ?? []);
            if (item) { resolved.push(item); } else { excluded.push(citeKey); }
        }

        return { resolved, excluded };
    }


    /**
     * closes the database connection to releases resources.
     */
    public close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Converts a SQL result into an array of plain objects keyed by column name.
     * @param sqlResult raw result from `db.exec()`
     */
    private getValues(sqlResult: initSqlJs.QueryExecResult[]): any[] {
        if (sqlResult.length === 0) { return []; }

        const { columns, values } = sqlResult[0];
        return values.map(row =>
            Object.fromEntries(columns.map((col, i) => [col, row[i]]))
        );
    }

    /**
     * returns only the first row of a SQL result as a plain object, or null if empty.
     * @param sqlResult raw result from `db.exec()`
     */
    private getFirstValue(sqlResult: initSqlJs.QueryExecResult[]): any | null {
        if (sqlResult.length === 0 || sqlResult[0].values.length === 0) {
            return null;
        }
        return this.getValues(sqlResult)[0];
    }

}