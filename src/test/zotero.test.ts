import * as assert from 'assert';
import {
    initZoteroDb,
    parseJsonFile,
} from './utils';

suite('ZoteroDatabase', () => {
    // -------------------------------------------------------------------------
    suite('ZoteroDatabase - Basics', () => {
        test('init and close database', async () => {
            const db = initZoteroDb('zotero.test.sqlite');
            await db.connect();
            assert.strictEqual(db.isConnected(), true);
            
            db.close();
            assert.strictEqual(db.isConnected(), false);
            
        });
        test('connectIfNeeded', async () => {
            const db = initZoteroDb('zotero.test.sqlite');
            await db.connectIfNeeded();
            assert.strictEqual(db.isConnected(), true);
            
            // calling connectIfNeeded again should not throw an error and should keep the connection open
            await db.connectIfNeeded();
            assert.strictEqual(db.isConnected(), true);
            db.close();
            assert.strictEqual(db.isConnected(), false);
        });
    });
    // -------------------------------------------------------------------------
    suite('ZoteroDatabase - Search & Open Items', () => {
        test('search items', async () => {
            const db = initZoteroDb('zotero.test.sqlite');
            await db.connect();
            
            const expectedItems = await parseJsonFile('items.test.json');
            const items = await db.getItems();
            assert.deepStrictEqual(items, expectedItems);
            db.close();
        });

        test('open options', async () => {
            const db = initZoteroDb('zotero.test.sqlite');
            await db.connect();
            
            const expectedItems = await parseJsonFile('open.test.json');
            const items = await db.getOpenOptions('shannon1948');
            assert.deepStrictEqual(items, expectedItems);
            db.close();
        });
    });
});
