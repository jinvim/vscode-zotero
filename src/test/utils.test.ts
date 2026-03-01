import * as assert from 'assert';
import { expandPath,
    formatAuthors,
    extractYear,
    extractDate,
    formatCiteKey,
    isValidBibEntry,
    fileExists
 } from '../utils';
 import { joinFixturePath } from './utils';

suite('Helpers', () => {
    test('expandPath', async () => {
        const absolute = "/Users/leejin/zotero.db";
        
        // test with absolute path (should return unchanged)
        const absResult = expandPath(absolute);
        assert.strictEqual(absResult, absolute);

        // test with relative path (should expand to absolute)
        const relResult = expandPath("~/zotero.db");
        assert.strictEqual(relResult, absolute);
    });
    test('formatAuthors', async () => {
        // test with no authors
        const noAuthors = formatAuthors([]);
        assert.strictEqual(noAuthors, 'NA');

        // if you are wondering, below are my cats' names
        // test with one author
        const oneAuthor = formatAuthors([{ creatorType: 'author', lastName: 'Crowley' }]);
        assert.strictEqual(oneAuthor, 'Crowley');
        
        // test with two authors
        const twoAuthors = formatAuthors([
            { creatorType: 'author', lastName: 'Crowley' },
            { creatorType: 'author', lastName: 'Ginger' }
        ]);
        assert.strictEqual(twoAuthors, 'Crowley & Ginger');
        
        // test with three authors
        const threeAuthors = formatAuthors([
            { creatorType: 'author', lastName: 'Crowley' },
            { creatorType: 'author', lastName: 'Ginger' },
            { creatorType: 'author', lastName: 'Luke' }
        ]);
        assert.strictEqual(threeAuthors, 'Crowley et al.');
    });
    
    test('extractYear', async () => {
        const year = extractYear('2024-04-08');
        assert.strictEqual(year, '2024');
        const yearOnly = extractYear('2024');
        assert.strictEqual(yearOnly, '2024');
        const yearFormatted = extractYear('April 8, 2024');
        assert.strictEqual(yearFormatted, '2024');
        const invalid = extractYear('invalid date');
        assert.strictEqual(invalid, null);
    });
    
    test('extractDate', async () => {
        const date = extractDate('2024-04-08');
        assert.strictEqual(date, '2024-04-08');
        const dateTime = extractDate('2024-04-08T12:00:00Z');
        assert.strictEqual(dateTime, '2024-04-08');
        const invalid = extractDate('invalid date');
        assert.strictEqual(invalid, null);
    });

    test('formatCitation', async () => {
        const latex = formatCiteKey('Crowley2020', 'latex');
        assert.strictEqual(latex, 'Crowley2020');
        const quarto = formatCiteKey('Ginger2020', 'quarto');
        assert.strictEqual(quarto, '@Ginger2020');
    });
    
    test('isValidBibEntry', async () => {
        const validEntry = `@article{Crowley2020,
            title={Example Article},
            author={Crowley, },
            year={2020}
        }`;
        assert.strictEqual(isValidBibEntry(validEntry), true);

        const invalidEntry = `title={Missing @ and key},
            author={Ginger, },
            year={2020}
        }`;
        assert.strictEqual(isValidBibEntry(invalidEntry), false);
    });

    test('fileExists', async () => {
        // test with existing file
        const existingUri = joinFixturePath('bib.test.bib');
        const existsResult = await fileExists(existingUri);
        assert.strictEqual(existsResult, true);

        // test with non-existing file
        const nonExistingUri = joinFixturePath('nonexistent.bib');
        const notExistsResult = await fileExists(nonExistingUri);
        assert.strictEqual(notExistsResult, false);
    });
});
