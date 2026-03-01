import * as assert from 'assert';
import * as vscode from 'vscode';
import { isValidBibEntry } from '../utils';
import {
    joinFixturePath,
    makeManagerFromFile,
    makeManagerWithContent
} from './utils';

suite('BibManager', () => {
    // -------------------------------------------------------------------------
    suite('locateBibFile — LaTeX', () => {
        teardown(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        test('\\bibliography{refs} → refs.bib', async () => {
            const manager = await makeManagerWithContent('\\bibliography{refs}', 'latex');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });

        test('\\bibliography{path/to/refs} → path/to/refs.bib', async () => {
            const manager = await makeManagerWithContent('\\bibliography{path/to/refs}', 'latex');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'path/to/refs.bib');
        });

        test('\\addbibresource{refs.bib} → refs.bib', async () => {
            const manager = await makeManagerWithContent('\\addbibresource{refs.bib}', 'latex');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });

        test('\\addbibresource{refs} → refs.bib (extension added)', async () => {
            const manager = await makeManagerWithContent('\\addbibresource{refs}', 'latex');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });
    });

    // -------------------------------------------------------------------------
    suite('locateBibFile — Markdown / Quarto', () => {
        teardown(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        test('YAML bibliography field (quarto)', async () => {
            const content = '---\nbibliography: refs.bib\n---\n';
            const manager = await makeManagerWithContent(content, 'quarto');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });

        test("YAML bibliography with quoted value 'refs.bib'", async () => {
            const content = "---\nbibliography: 'refs.bib'\n---\n";
            const manager = await makeManagerWithContent(content, 'markdown');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });

        test('YAML bibliography as a list with multiple entries', async () => {
            const content = '---\nbibliography: [refs.bib, other.bib]\n---\n';
            const manager = await makeManagerWithContent(content, 'markdown');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });

        test('YAML bibliography as a list with multi-line list', async () => {
            const content = '---\nbibliography:\n- refs.bib\n- other.bib\n---\n';
            const manager = await makeManagerWithContent(content, 'markdown');
            const result = await manager.locateBibFile();
            assert.strictEqual(result, 'refs.bib');
        });
    });
    suite('BibManager - Better BibTeX', () => {
        test('bbtExport', async () => {
            const manager = await makeManagerWithContent('', 'latex');
            // test that the exported BibTeX entry is valid
            const validItem = await manager.bbtExport(
                {citeKey: 'shannon1948'}
            );
            const valid = isValidBibEntry(validItem);
            assert.strictEqual(valid, true);

            const invalidItem = await manager.bbtExport(
                {citeKey: 'crowley2020'}
            );
            assert.strictEqual(invalidItem, '');
        });
    });

    suite('BibManager - Other functions', () => {
        teardown(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        test('resolveBibUri (Absolute)', async () => {
            const manager = await makeManagerWithContent('', 'latex');
            const absPath = '/home/user/refs.bib';
            const expectedPath = vscode.Uri.file(absPath).path;
            const result = (manager as any).resolveBibUri(absPath);

            assert.strictEqual(result.path, expectedPath);
        });

        test('resolveBibUri (Relative)', async () => {
            const manager = await makeManagerFromFile('bib.test.bib', 'latex');
            const relPath = '../refs.bib';
            const expectedPath = joinFixturePath(relPath).path;
            const result = (manager as any).resolveBibUri(relPath);
            assert.strictEqual(result.path, expectedPath);
        });

        test('fileExists', async () => {
            const manager = await makeManagerWithContent('', 'latex');
            // test with existing file
            const existingUri = joinFixturePath('bib.test.bib');
            const existsResult = await (manager as any).fileExists(existingUri);
            assert.strictEqual(existsResult, true);

            // test with non-existing file
            const nonExistingUri = joinFixturePath('nonexistent.bib');
            const notExistsResult = await (manager as any).fileExists(nonExistingUri);
            assert.strictEqual(notExistsResult, false);
        });
        
        test('readFileAsString', async () => {
            const manager = await makeManagerWithContent('', 'latex');
            const fileUri = joinFixturePath('bib.test.bib');
            
            const expectedContent = [
                '@article{shannon1948,',
                '  title = {A Mathematical Theory of Communication},',
                '  author = {Shannon, C. E.},',
                '  date = {1948-07},',
                '  journaltitle = {The Bell System Technical Journal},',
                '  volume = {27},',
                '  number = {3},',
                '  pages = {379--423},',
                '  issn = {0005-8580},',
                '  doi = {10.1002/j.1538-7305.1948.tb01338.x}',
                '}',
            ].join('\n');
            const content = await (manager as any).readFileAsString(fileUri);
            assert.strictEqual(content.trim(), expectedContent.trim());
        });

        test('checkCiteKeyExists', async () => {
            const manager = await makeManagerWithContent('', 'latex');
            const bibUri = joinFixturePath('bib.test.bib');
            const bibContent = await (manager as any).readFileAsString(bibUri);
        
            // existing cite key
            const existsResult = await (manager as any).checkCiteKeyExists('shannon1948', bibContent);
            assert.strictEqual(existsResult, true);
            
            // non-existing cite key
            const notExistsResult = await (manager as any).checkCiteKeyExists('crowley2020', bibContent);
            assert.strictEqual(notExistsResult, false);
        });
    // unimplemented tests
    });
});
