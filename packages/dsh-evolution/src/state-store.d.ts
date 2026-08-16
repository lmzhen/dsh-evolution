/**
 * Small crash-safe JSON state store for plugin-owned sidecar state.
 * Writes are atomic (temp + rename). Reads are synchronous for startup use.
 */
export declare function evolutionHome(env?: NodeJS.ProcessEnv): string;
export declare class JsonState<T> {
    private readonly initial;
    readonly path: string;
    private value;
    constructor(name: string, initial: T, env?: NodeJS.ProcessEnv);
    private loadSync;
    get(): T;
    set(value: T): void;
    update(mutator: (value: T) => void): void;
    flush(): Promise<void>;
    /** Merge-on-load helper for persisted maps/records. */
    reload(): Promise<void>;
}
//# sourceMappingURL=state-store.d.ts.map