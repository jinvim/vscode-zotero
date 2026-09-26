import * as fs from 'fs/promises';
import { constants as bufferConstants } from 'buffer';

/** SQLite's WAL stores complete changed pages, not rows. This produces an in-memory
 * database image for sql.js without writing to Zotero's database or checkpointing it.
 * See https://sqlite.org/fileformat2.html#the_write_ahead_log
 */
function checksum(bytes: Buffer, from: number, to: number, first: number, second: number, littleEndian: boolean): [number, number] {
    for (let i = from; i < to; i += 8) {
        first = (first + second + (littleEndian ? bytes.readUInt32LE(i) : bytes.readUInt32BE(i))) >>> 0;
        second = (second + first + (littleEndian ? bytes.readUInt32LE(i + 4) : bytes.readUInt32BE(i + 4))) >>> 0;
    }
    return [first, second];
}

/** Apply frames only through the last valid commit. Subsequent uncommitted frames
 * or an incomplete/invalid tail must not be shown in the picker. */
export function applyWal(database: Buffer, wal: Buffer): Buffer {
    if (wal.length === 0) { return database; }
    if (wal.length < 32 || database.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') {
        throw new Error('Invalid SQLite database or WAL header');
    }

    const magic = wal.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) {
        throw new Error('Invalid SQLite WAL magic');
    }
    const littleEndian = magic === 0x377f0682; // checksum word order, not frame fields
    const pageSize = wal.readUInt32BE(8);
    const dbPageSize = database.readUInt16BE(16) || 65536;
    if (wal.readUInt32BE(4) !== 3007000 || pageSize !== dbPageSize ||
        pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 ||
        database.length % pageSize !== 0) {
        throw new Error('Invalid or mismatched SQLite WAL page size');
    }
    let [first, second] = checksum(wal, 0, 24, 0, 0, littleEndian);
    if (first !== wal.readUInt32BE(24) || second !== wal.readUInt32BE(28)) {
        throw new Error('Invalid SQLite WAL header checksum');
    }

    const frames = new Map<number, number>();
    let committedFrames = new Map<number, number>();
    let committedPages = 0;
    const frameSize = 24 + pageSize;
    for (let offset = 32; offset + frameSize <= wal.length; offset += frameSize) {
        const page = wal.readUInt32BE(offset);
        if (page === 0 || wal.readUInt32BE(offset + 8) !== wal.readUInt32BE(16) ||
            wal.readUInt32BE(offset + 12) !== wal.readUInt32BE(20)) { break; }
        let next = checksum(wal, offset, offset + 8, first, second, littleEndian);
        next = checksum(wal, offset + 24, offset + frameSize, next[0], next[1], littleEndian);
        if (next[0] !== wal.readUInt32BE(offset + 16) || next[1] !== wal.readUInt32BE(offset + 20)) { break; }
        [first, second] = next;
        frames.set(page, offset + 24);
        const pages = wal.readUInt32BE(offset + 4);
        if (pages !== 0) {
            committedPages = pages;
            committedFrames = new Map(frames);
        }
    }
    if (!committedPages) { return database; }
    const size = committedPages * pageSize;
    if (size > bufferConstants.MAX_LENGTH) { throw new Error('SQLite WAL snapshot too large'); }
    const snapshot = Buffer.alloc(size);
    database.copy(snapshot, 0, 0, Math.min(database.length, size));
    for (const [page, offset] of committedFrames) {
        if (page <= committedPages) {
            wal.copy(snapshot, (page - 1) * pageSize, offset, offset + pageSize);
        }
    }
    return snapshot;
}

function sameFile(a: import('fs').BigIntStats | null, b: import('fs').BigIntStats | null): boolean {
    return a === b || !!a && !!b && a.dev === b.dev && a.ino === b.ino &&
        a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

async function optionalStat(file: string) {
    try { return await fs.stat(file, { bigint: true }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return null; }
        throw error;
    }
}

/** Retry if Zotero checkpoints or replaces the WAL during our read. This is a
 * best-effort read-only snapshot, not a SQLite-locked transaction. */
export async function readWalSnapshot(file: string): Promise<Buffer> {
    const walFile = `${file}-wal`;
    for (let attempt = 0; attempt < 3; attempt++) {
        const beforeDb = await fs.stat(file, { bigint: true });
        const beforeWal = await optionalStat(walFile);
        const database = await fs.readFile(file);
        let wal: Buffer | null = null;
        try { if (beforeWal) { wal = await fs.readFile(walFile); } }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
        }
        const afterDb = await fs.stat(file, { bigint: true });
        const afterWal = await optionalStat(walFile);
        if (!sameFile(beforeDb, afterDb) || !sameFile(beforeWal, afterWal) ||
            beforeDb.size !== BigInt(database.length) ||
            (beforeWal !== null && (wal === null || beforeWal.size !== BigInt(wal.length)))) { continue; }
        return wal ? applyWal(database, wal) : database;
    }
    throw new Error('Zotero database changed during snapshot; retry the picker');
}
