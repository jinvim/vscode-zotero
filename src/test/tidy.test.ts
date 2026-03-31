import * as assert from 'assert';
import { parseCiteKeys } from '../tidy';

function parseTexKeys(content: string): Set<string> {
    return parseCiteKeys(content, 'tex');
}

suite('parseTexKeys', () => {

    suite('basic cite commands', () => {
        test('\\cite{key}', () => {
            const result = parseTexKeys('\\cite{smith2020}');
            assert.deepStrictEqual(result, new Set(['smith2020']));
        });

        test('\\citep{key}', () => {
            const result = parseTexKeys('\\citep{jones1999}');
            assert.deepStrictEqual(result, new Set(['jones1999']));
        });

        test('\\citet{key}', () => {
            const result = parseTexKeys('\\citet{doe2021}');
            assert.deepStrictEqual(result, new Set(['doe2021']));
        });

        test('\\Citet{key}', () => {
            const result = parseTexKeys('\\Citet{doe2021}');
            assert.deepStrictEqual(result, new Set(['doe2021']));
        });

        test('\\citeauthor{key}', () => {
            const result = parseTexKeys('\\citeauthor{doe2021}');
            assert.deepStrictEqual(result, new Set(['doe2021']));
        });

        test('\\cite*{key}', () => {
            const result = parseTexKeys('\\cite*{doe2021}');
            assert.deepStrictEqual(result, new Set(['doe2021']));
        });
    });

    suite('optional arguments [...]', () => {
        test('\\cite[p.~10]{key}', () => {
            const result = parseTexKeys('\\cite[p.~10]{smith2020}');
            assert.deepStrictEqual(result, new Set(['smith2020']));
        });

        test('\\cite[see][p. 5]{key}', () => {
            const result = parseTexKeys('\\cite[see][p. 5]{smith2020}');
            assert.deepStrictEqual(result, new Set(['smith2020']));
        });
    });

    suite('multiple keys', () => {
        test('\\cite{key1,key2}', () => {
            const result = parseTexKeys('\\cite{smith2020,jones1999}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'jones1999']));
        });

        test('keys with spaces around commas', () => {
            const result = parseTexKeys('\\cite{smith2020, jones1999 , doe2021}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'jones1999', 'doe2021']));
        });

        test('\\cite{key1}{key2}', () => {
            const result = parseTexKeys('\\cite{smith2020}{jones1999}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'jones1999']));
        });
        test('\\cite[opt]{key1}{key2}', () => {
            const result = parseTexKeys('\\cite[see]{smith2020}{jones1999}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'jones1999']));
        });
    });

    suite('chained commands', () => {
        test('two cite commands', () => {
            const result = parseTexKeys('\\cite{smith2020}\\citep{jones1999}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'jones1999']));
        });

        test('one cite, one different command', () => {
            const result = parseTexKeys('\\cite{smith2020}\\textbf{Not a cite}\\citet{doe2021}');
            assert.deepStrictEqual(result, new Set(['smith2020', 'doe2021']));
        });
    });

    suite('\\nocite exclusion', () => {
        test('\\nocite{key} is excluded', () => {
            const result = parseTexKeys('\\nocite{hidden2020}');
            assert.deepStrictEqual(result, new Set());
        });
    });

    suite('no cite commands', () => {
        test('empty string returns empty set', () => {
            const result = parseTexKeys('');
            assert.deepStrictEqual(result, new Set());
        });
    });
});
