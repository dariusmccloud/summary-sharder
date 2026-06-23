import fs from 'node:fs';
import { Database } from 'bun:sqlite';

function bindArgs(parameters = []) {
    return Array.isArray(parameters) ? parameters : [parameters];
}

function rowValue(row) {
    if (!row) return null;
    const values = Object.values(row);
    return values.length > 0 ? values[0] : null;
}

export function createBunSqliteAdapter(dbPath) {
    const db = new Database(dbPath);

    return {
        runtime: 'bun',
        dbPath,
        exec(sql) {
            db.exec(sql);
        },
        run(sql, parameters = []) {
            return db.run(sql, ...bindArgs(parameters));
        },
        get(sql, parameters = []) {
            return db.query(sql).get(...bindArgs(parameters));
        },
        all(sql, parameters = []) {
            return db.query(sql).all(...bindArgs(parameters));
        },
        scalar(sql, parameters = []) {
            return rowValue(db.query(sql).get(...bindArgs(parameters)));
        },
        transaction(callback) {
            db.exec('BEGIN IMMEDIATE');
            try {
                const result = callback(this);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                try {
                    db.exec('ROLLBACK');
                } catch {
                    // ignore rollback failure; original error is more useful
                }
                throw error;
            }
        },
        getJournalMode() {
            return String(this.scalar('PRAGMA journal_mode') || '').toUpperCase();
        },
        verifyIntegrity() {
            return String(this.scalar('PRAGMA quick_check(1)') || '').toLowerCase() === 'ok';
        },
        createManagedSnapshot(snapshotPath) {
            const bytes = db.serialize();
            fs.writeFileSync(snapshotPath, Buffer.from(bytes));
        },
        close() {
            db.close(false);
        },
    };
}
