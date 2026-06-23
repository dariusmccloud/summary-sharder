import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    JOURNAL_MODE,
    SCHEMA_VERSION,
    SERVICE_VERSION,
    getStoragePaths,
    loadManifest,
    openOperationalDatabase,
    snapshotOperationalDatabase,
} from './core.js';

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'summary-sharder-memory-'));
}

test('operational database initializes manifest and journal mode', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);
    const adapter = openOperationalDatabase(paths);

    try {
        const manifest = loadManifest(adapter);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        assert.equal(manifest.serviceVersion, SERVICE_VERSION);
        assert.equal(manifest.journalMode, JOURNAL_MODE);
        assert.equal(adapter.getJournalMode(), JOURNAL_MODE);
        assert.equal(fs.existsSync(paths.statePath), true);
    } finally {
        adapter.close();
    }
});

test('managed snapshot is created and verified', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);
    const adapter = openOperationalDatabase(paths);

    try {
        const manifest = snapshotOperationalDatabase(adapter, paths);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        assert.equal(fs.existsSync(paths.snapshotPath), true);
    } finally {
        adapter.close();
    }
});

test('corrupt operational database restores from verified snapshot', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.writeFileSync(paths.dbPath, Buffer.from('corrupt-db'));

    const restored = openOperationalDatabase(paths);
    try {
        const manifest = loadManifest(restored);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
        const quarantineFiles = fs.readdirSync(paths.storageRoot).filter((name) => name.includes('.quarantine.'));
        assert.equal(quarantineFiles.length > 0, true);
    } finally {
        restored.close();
    }
});

test('missing valid snapshot after corruption reaches rebuild boundary', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.writeFileSync(paths.dbPath, Buffer.from('corrupt-db'));
    fs.writeFileSync(paths.snapshotPath, Buffer.from('corrupt-snapshot'));

    assert.throws(
        () => openOperationalDatabase(paths),
        /requires rebuild/i,
    );
});

test('missing operational database restores from verified snapshot', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.rmSync(paths.dbPath, { force: true });

    const restored = openOperationalDatabase(paths);
    try {
        const manifest = loadManifest(restored);
        assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
    } finally {
        restored.close();
    }
});

test('missing operational database and snapshot fail closed after adoption', () => {
    const root = makeTempRoot();
    const paths = getStoragePaths(root);

    {
        const adapter = openOperationalDatabase(paths);
        try {
            snapshotOperationalDatabase(adapter, paths);
        } finally {
            adapter.close();
        }
    }

    fs.rmSync(paths.dbPath, { force: true });
    fs.rmSync(paths.snapshotPath, { force: true });

    assert.throws(
        () => openOperationalDatabase(paths),
        /requires rebuild/i,
    );
});
