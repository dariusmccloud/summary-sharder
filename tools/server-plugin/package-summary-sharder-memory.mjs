import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_PLUGIN_ROOT = path.join(__dirname, 'summary-sharder-memory');

const STATIC_PAYLOAD_FILES = Object.freeze([
    'package.json',
    'README.md',
    'index.js',
    'core.js',
    'interpretive.js',
    'promotion.js',
    'rebuild.js',
    'schema.js',
    'sqlite-node.js',
    'sqlite-bun.js',
]);

const RUNTIME_SHARED_ENTRYPOINTS = Object.freeze([
    'core/summarization/sharder-section-registry.js',
    'core/summarization/architectural-authority-store.js',
    'core/summarization/architectural-dialogue-claim-extractor.js',
    'core/summarization/architectural-rebuild-protocol.js',
    'core/summarization/architectural-sharder-format.js',
    'core/summarization/saved-shard-identity.js',
    'core/summarization/shard-integrity-core.js',
]);

function normalizeRelative(relativePath) {
    return relativePath.replace(/\\/g, '/');
}

function sha256File(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ensureDirectoryFor(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseRelativeImports(sourceText) {
    const imports = [];
    const patterns = [
        /import\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /import\s*['"]([^'"]+)['"]/g,
        /export\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(sourceText)) !== null) {
            const specifier = match[1];
            if (specifier.startsWith('.')) {
                imports.push(specifier);
            }
        }
    }
    return [...new Set(imports)];
}

function resolveModulePath(fromFile, specifier) {
    const resolved = path.resolve(path.dirname(fromFile), specifier);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
    }
    if (fs.existsSync(`${resolved}.js`)) {
        return `${resolved}.js`;
    }
    if (fs.existsSync(path.join(resolved, 'index.js'))) {
        return path.join(resolved, 'index.js');
    }
    throw new Error(`Unable to resolve ${specifier} from ${fromFile}`);
}

function collectSharedDependencyClosure(repoRoot) {
    const visited = new Set();
    const output = new Set();
    const queue = [...RUNTIME_SHARED_ENTRYPOINTS.map((entry) => path.join(repoRoot, entry))];

    while (queue.length > 0) {
        const current = queue.pop();
        const normalized = path.normalize(current);
        if (visited.has(normalized)) {
            continue;
        }
        visited.add(normalized);
        if (!normalized.startsWith(path.join(repoRoot, 'core'))) {
            throw new Error(`Shared dependency escaped canonical core root: ${normalized}`);
        }
        output.add(normalized);
        const source = fs.readFileSync(normalized, 'utf8');
        for (const specifier of parseRelativeImports(source)) {
            const resolved = resolveModulePath(normalized, specifier);
            if (resolved.startsWith(path.join(repoRoot, 'core'))) {
                queue.push(resolved);
            }
        }
    }

    return [...output].sort((a, b) => a.localeCompare(b));
}

function cleanGeneratedCoreRoot(generatedCoreRoot) {
    fs.rmSync(generatedCoreRoot, { recursive: true, force: true });
    fs.mkdirSync(generatedCoreRoot, { recursive: true });
}

function writeJson(filePath, value) {
    ensureDirectoryFor(filePath);
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildPayloadManifest(sharedEntries, {
    repoRoot,
    sourcePluginRoot,
    outputPluginRoot,
    sharedManifestPath,
}) {
    const sharedModules = sharedEntries.map((entry) => {
        const canonicalRelativePath = normalizeRelative(path.relative(repoRoot, entry));
        const packagedRelativePath = normalizeRelative(path.join('lib', canonicalRelativePath));
        return {
            canonicalRelativePath,
            packagedRelativePath,
            sha256: sha256File(entry),
        };
    });

    const payloadFiles = [
        ...STATIC_PAYLOAD_FILES.map((relativePath) => ({
            relativePath,
            sha256: sha256File(path.join(sourcePluginRoot, relativePath)),
        })),
        ...sharedModules.map((entry) => ({
            relativePath: entry.packagedRelativePath,
            sha256: entry.sha256,
        })),
        {
            relativePath: normalizeRelative(path.relative(outputPluginRoot, sharedManifestPath)),
            sha256: sha256File(sharedManifestPath),
        },
    ].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    return {
        pluginId: 'summary-sharder-memory',
        canonicalRoot: 'core',
        generatedBy: 'tools/server-plugin/package-summary-sharder-memory.mjs',
        staticPayloadFiles: [...STATIC_PAYLOAD_FILES],
        sharedModules,
        payloadFiles,
    };
}

export function packageSummarySharderMemoryPlugin(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
    const sourcePluginRoot = path.resolve(options.sourcePluginRoot || SOURCE_PLUGIN_ROOT);
    const outputPluginRoot = path.resolve(options.outputPluginRoot || sourcePluginRoot);
    const libRoot = path.join(outputPluginRoot, 'lib');
    const generatedCoreRoot = path.join(libRoot, 'core');
    const sharedManifestPath = path.join(libRoot, 'packaged-shared-manifest.json');
    const payloadManifestPath = path.join(outputPluginRoot, 'payload-manifest.json');

    cleanGeneratedCoreRoot(generatedCoreRoot);
    const sharedEntries = collectSharedDependencyClosure(repoRoot);

    for (const relativePath of STATIC_PAYLOAD_FILES) {
        const sourcePath = path.join(sourcePluginRoot, relativePath);
        const targetPath = path.join(outputPluginRoot, relativePath);
        ensureDirectoryFor(targetPath);
        fs.copyFileSync(sourcePath, targetPath);
    }

    for (const entry of sharedEntries) {
        const canonicalRelativePath = path.relative(repoRoot, entry);
        const targetPath = path.join(outputPluginRoot, 'lib', canonicalRelativePath);
        ensureDirectoryFor(targetPath);
        fs.copyFileSync(entry, targetPath);
    }

    const sharedManifest = {
        pluginId: 'summary-sharder-memory',
        canonicalRoot: 'core',
        generatedBy: 'tools/server-plugin/package-summary-sharder-memory.mjs',
        modules: sharedEntries.map((entry) => ({
            canonicalRelativePath: normalizeRelative(path.relative(repoRoot, entry)),
            packagedRelativePath: normalizeRelative(path.relative(outputPluginRoot, path.join(outputPluginRoot, 'lib', path.relative(repoRoot, entry)))),
            sha256: sha256File(entry),
        })),
    };
    writeJson(sharedManifestPath, sharedManifest);

    const payloadManifest = buildPayloadManifest(sharedEntries, {
        repoRoot,
        sourcePluginRoot,
        outputPluginRoot,
        sharedManifestPath,
    });
    writeJson(payloadManifestPath, payloadManifest);
    return payloadManifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const manifest = packageSummarySharderMemoryPlugin();
    process.stdout.write(`${JSON.stringify({
        ok: true,
        pluginId: manifest.pluginId,
        payloadFileCount: manifest.payloadFiles.length,
        sharedModuleCount: manifest.sharedModules.length,
        manifestPath: normalizeRelative(path.relative(REPO_ROOT, path.join(SOURCE_PLUGIN_ROOT, 'payload-manifest.json'))),
    }, null, 2)}\n`);
}
