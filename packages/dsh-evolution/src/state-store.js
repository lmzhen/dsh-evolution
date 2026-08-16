/**
 * Small crash-safe JSON state store for plugin-owned sidecar state.
 * Writes are atomic (temp + rename). Reads are synchronous for startup use.
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
export function evolutionHome(env = process.env) {
    return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution');
}
export class JsonState {
    initial;
    path;
    value;
    constructor(name, initial, env = process.env) {
        this.initial = initial;
        this.path = join(evolutionHome(env), name);
        this.value = this.loadSync();
    }
    loadSync() {
        try {
            const raw = readFileSync(this.path, 'utf8');
            const parsed = JSON.parse(raw);
            return { ...this.initial, ...parsed };
        }
        catch {
            return { ...this.initial };
        }
    }
    get() {
        return this.value;
    }
    set(value) {
        this.value = value;
    }
    update(mutator) {
        mutator(this.value);
    }
    async flush() {
        await mkdir(dirname(this.path), { recursive: true });
        const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
        await writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8');
        await rename(tmp, this.path);
    }
    /** Merge-on-load helper for persisted maps/records. */
    async reload() {
        try {
            const raw = await readFile(this.path, 'utf8');
            this.value = { ...this.initial, ...JSON.parse(raw) };
        }
        catch {
            this.value = { ...this.initial };
        }
    }
}
//# sourceMappingURL=state-store.js.map