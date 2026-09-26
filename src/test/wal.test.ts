import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { applyWal, readWalSnapshot } from '../wal';

// Construct WAL frames independently of applyWal, using SQLite's documented
// header, salts, rolling checksum, and commit marker layout.
function checksum(bytes: Buffer, first: number, second: number): [number, number] {
    for (let i = 0; i < bytes.length; i += 8) {
        first = (first + second + bytes.readUInt32LE(i)) >>> 0;
        second = (second + first + bytes.readUInt32LE(i + 4)) >>> 0;
    }
    return [first, second];
}

function makeWal(base: Buffer, revisions: { image: Buffer; commit: boolean }[]): Buffer {
    const pageSize = base.readUInt16BE(16) || 65536;
    const header = Buffer.alloc(32);
    header.writeUInt32BE(0x377f0682, 0);
    header.writeUInt32BE(3007000, 4);
    header.writeUInt32BE(pageSize, 8);
    header.writeUInt32BE(1234, 16);
    header.writeUInt32BE(5678, 20);
    let [first, second] = checksum(header.subarray(0, 24), 0, 0);
    header.writeUInt32BE(first, 24);
    header.writeUInt32BE(second, 28);
    const frames = [header];
    let previous = base;
    for (const { image, commit } of revisions) {
        const changed: number[] = [];
        for (let page = 1; page <= image.length / pageSize; page++) {
            const from = (page - 1) * pageSize;
            if (!image.subarray(from, from + pageSize).equals(previous.subarray(from, from + pageSize))) {
                changed.push(page);
            }
        }
        if (changed.length === 0) { throw new Error('Test revision contains no changes'); }
        for (const [index, page] of changed.entries()) {
            const frame = Buffer.alloc(24 + pageSize);
            frame.writeUInt32BE(page, 0);
            if (commit && index === changed.length - 1) {
                frame.writeUInt32BE(image.length / pageSize, 4);
            }
            header.copy(frame, 8, 16, 24);
            image.copy(frame, 24, (page - 1) * pageSize, page * pageSize);
            [first, second] = checksum(Buffer.concat([frame.subarray(0, 8), frame.subarray(24)]), first, second);
            frame.writeUInt32BE(first, 16);
            frame.writeUInt32BE(second, 20);
            frames.push(frame);
        }
        previous = image;
    }
    return Buffer.concat(frames);
}

suite('SQLite WAL picker snapshot', () => {
    test('overlays committed inserts, but not uncommitted or damaged frames', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.run('CREATE TABLE picker (citeKey TEXT); INSERT INTO picker VALUES (\'old\')');
        const base = Buffer.from(db.export());
        db.run('INSERT INTO picker VALUES (\'kim2026a\')');
        const committed = Buffer.from(db.export());
        db.run('INSERT INTO picker VALUES (\'notCommitted\')');
        const uncommitted = Buffer.from(db.export());
        db.close();

        const wal = makeWal(base, [
            { image: committed, commit: true },
            { image: uncommitted, commit: false },
        ]);
        const readKeys = (image: Buffer): string[] => {
            const snapshot = new SQL.Database(image);
            const keys = snapshot.exec('SELECT citeKey FROM picker ORDER BY citeKey')[0].values.map(row => row[0] as string);
            snapshot.close();
            return keys;
        };
        assert.deepStrictEqual(readKeys(applyWal(base, wal)), ['kim2026a', 'old']);
        assert.deepStrictEqual(readKeys(applyWal(base, makeWal(base, [{ image: committed, commit: false }]))), ['old']);
        assert.deepStrictEqual(readKeys(applyWal(base, wal.subarray(0, wal.length - 20))), ['kim2026a', 'old']);
        const damaged = Buffer.from(wal);
        damaged[damaged.length - 1] ^= 1;
        assert.deepStrictEqual(readKeys(applyWal(base, damaged)), ['kim2026a', 'old']);
        const badHeader = Buffer.from(wal);
        badHeader[24] ^= 1;
        assert.throws(() => applyWal(base, badHeader), /checksum/);
    });

    test('reads only from disk and retains no-WAL behavior', async () => {
        const SQL = await initSqlJs();
        const db = new SQL.Database();
        db.run('CREATE TABLE picker (citeKey TEXT); INSERT INTO picker VALUES (\'old\')');
        const base = Buffer.from(db.export());
        db.run('INSERT INTO picker VALUES (\'kim2026a\')');
        const revised = Buffer.from(db.export());
        db.close();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zotero-wal-test-'));
        const file = path.join(dir, 'zotero.sqlite');
        try {
            await fs.writeFile(file, base);
            assert.deepStrictEqual(await readWalSnapshot(file), base);
            const wal = makeWal(base, [{ image: revised, commit: true }]);
            await fs.writeFile(`${file}-wal`, wal);
            const snapshot = await readWalSnapshot(file);
            const opened = new SQL.Database(snapshot);
            assert.strictEqual(opened.exec("SELECT count(*) FROM picker WHERE citeKey = 'kim2026a'")[0].values[0][0], 1);
            opened.close();
            assert.deepStrictEqual(await fs.readFile(file), base);
            assert.deepStrictEqual(await fs.readFile(`${file}-wal`), wal);
        } finally {
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
