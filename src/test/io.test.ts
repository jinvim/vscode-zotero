import * as assert from 'assert';
import { readFileAsString } from '../io';
import {
    joinFixturePath,
} from './utils';

suite('IO', () => {
    test('readFileAsString', async () => {
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
        const content = await readFileAsString(fileUri);
        assert.strictEqual(content.trim(), expectedContent.trim());
    });
});
