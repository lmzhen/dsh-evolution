/** G2 opaque UnitTransaction. Core owns prepare/commit/verify/rollback lifecycle. */
import { createHash } from "node:crypto";
import type { EvolutionIoLike } from "./io.ts";
import { acquireTreeWriteLock, type TreeLock } from "./tree-lock.ts";
import {
  readUnitEvidence,
  readUnitReceipt,
  readUnitSnapshot,
  unitStorageKey,
  writeUnitEvidence,
  writeUnitReceipt,
  writeUnitSnapshot,
  type UnitEvidenceRecord,
  type UnitSnapshot,
} from "./unit-storage.ts";
import { readUnitJournal, writeUnitJournal, type UnitJournal, type UnitJournalCheckpoint, type UnitJournalPhase } from "./unit-journal.ts";

export interface UnitSupportFile {
  readonly path: string;
  readonly content: string;
}
export interface UnitPlan {
  readonly runId: string;
  /** Filled by the transaction before the backend write; history records it. */
  readonly unitId?: string;
  readonly pairKey: string;
  readonly target: string;
  readonly targetExists: boolean;
  readonly sources: readonly string[];
  readonly body: string;
  readonly supportFiles: readonly UnitSupportFile[];
  readonly expectedTargetBody: string | null;
  readonly expectedSourceBodies: readonly { name: string; body: string }[];
  readonly origin: "foreground" | "subagent" | "background_review";
  readonly summary: string;
  readonly skillLimits?: import("./limits.ts").SkillLimits;
  readonly limitsDigest?: string;
  readonly validationPlan?: { readonly planVersion: 1; readonly stageDigest: string; readonly revision: string };
  readonly targetRevision?: { readonly kind: 'absent' } | { readonly kind: 'present'; readonly sha256: string };
  readonly sourceRevisions?: Readonly<Record<string, { readonly kind: 'absent' } | { readonly kind: 'present'; readonly sha256: string }>>;
  readonly supportDigest?: string;
}
export interface UnitCommitResult {
  readonly ok: boolean;
  readonly message: string;
  /** Typed backend refusal (revision CAS); absent means a generic commit failure. */
  readonly code?: UnitErrorCode;
  readonly archived?: readonly string[];
  readonly mutations?: number;
}
export interface UnitBackend {
  readSkill(name: string): Promise<string | null>;
  readSupportFile(name: string, path: string): Promise<string | null>;
  commit(
    plan: UnitPlan,
    onPhase?: (
      phase:
        | "target-pending"
        | "target-applied"
        | "target-written"
        | "source-archiving"
        | "sources-archived"
        | "support-pending"
        | "unit-written",
      detail?: { source?: string },
    ) => void | Promise<void>,
    signal?: AbortSignal,
    assertFence?: () => Promise<boolean>,
  ): Promise<UnitCommitResult>;
  restoreTarget(name: string, body: string | null): Promise<void>;
  restoreSource(name: string, body: string): Promise<void>;
  restoreSupportFile?(name: string, path: string, content: string | null): Promise<void>;
}
export interface UnitClaim {
  release(): Promise<void>;
}
export interface UnitClaimPort {
  acquire(target: string, runId: string): Promise<UnitClaim>;
}
export interface UnitTransactionOptions {
  readonly io: EvolutionIoLike;
  readonly home: string;
  readonly backend: UnitBackend;
  readonly claim: UnitClaimPort;
  readonly now?: () => number;
  readonly waitMs?: number;
  /** Gate/fault-injection seam: called after each journal phase is durable. */
  readonly onPhase?: (phase: UnitJournalPhase) => void | Promise<void>;
  /** Gate instrumentation: tree fence then target claim. */
  readonly onLock?: (lock: "tree" | "claim") => void;
}
export type UnitErrorCode =
  | "unit-plan-missing"
  | "unit-conflict"
  | "unit-committed"
  | "unit-prepare-failed"
  | "unit-commit-failed"
  | "unit-claim-failed"
  | "unit-fence-failed"
  | "unit-rollback-blocked"
  | "target-changed"
  | "source-changed"
  | "support-changed";
export interface UnitFailure {
  readonly ok: false;
  readonly code: UnitErrorCode;
  readonly message: string;
}
export interface UnitPrepared {
  readonly unitId: string;
  readonly planDigest: string;
}
export interface UnitTransaction {
  prepare(plan: UnitPlan): Promise<{ ok: true; prepared: UnitPrepared } | UnitFailure>;
  commit(prepared: UnitPrepared, options?: { signal?: AbortSignal }): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure>;
  verify(ref: { unitId: string } | { runId: string }): Promise<UnitEvidenceRecord | UnitEvidenceRecord[] | null>;
  rollback(ref: { unitId: string; reason: string }): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure>;
  finalize(unitId: string): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure>;
  rollForward(unitId: string): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure>;
  cancel(unitId: string, reason: string): Promise<{ ok: boolean; phase: UnitJournalPhase | "none" }>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(object[key]))
      .join(",") +
    "}"
  );
}
function digest(plan: UnitPlan): string {
  return createHash("sha256").update(canonical(plan)).digest("hex");
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(object[key])).join(',') + '}'
}
export function unitEvidenceDigest(evidence: UnitEvidenceRecord): string {
  return createHash("sha256").update(canonicalJson({ ...evidence, at: 0, mutations: 0 })).digest("hex")
}
function evidenceDigest(evidence: UnitEvidenceRecord): string {
  return createHash("sha256").update(JSON.stringify({ ...evidence, at: 0, mutations: 0 }, null, 2) + "\n").digest("hex");
}

export class UnitTransactions implements UnitTransaction {
  private readonly prepared = new Map<string, { plan: UnitPlan; digest: string; at: number; snapshotSha256: string }>();
  private readonly commits = new Map<string, Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure>>();
  private readonly now: () => number;
  constructor(private readonly options: UnitTransactionOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  private unitId(plan: UnitPlan): string {
    // DEC-D5: the caller may provide the unitId and still get idempotent prepare/commit.
    // Deriving one remains the fallback for callers that do not.
    return plan.unitId ?? plan.runId + ":" + createHash("sha256").update(plan.pairKey).digest("hex").slice(0, 16);
  }

  private async snapshot(plan: UnitPlan, unitId: string, planDigest: string): Promise<UnitSnapshot> {
    const targetBefore = await this.options.backend.readSkill(plan.target);
    const supportBefore = await Promise.all(
      plan.supportFiles.map(async (file) => ({
        path: file.path,
        content: await this.options.backend.readSupportFile(plan.target, file.path),
      })),
    );
    const sourceBefore = await Promise.all(
      plan.sources
        .filter((source) => source !== plan.target)
        .map(async (name) => ({ name, body: (await this.options.backend.readSkill(name)) ?? "" })),
    );
    return {
      schemaVersion: 1,
      unitId,
      planDigest,
      runId: plan.runId,
      target: plan.target,
      targetExists: plan.targetExists,
      targetBefore,
      targetAfter: plan.body,
      supportBefore,
      supportAfter: plan.supportFiles,
      sourceBefore,
      origin: plan.origin,
      summary: plan.summary,
      ...(plan.validationPlan === undefined ? {} : { validationPlan: plan.validationPlan }),
      createdAt: this.now(),
    };
  }

  async prepare(plan: UnitPlan) {
    const unitId = this.unitId(plan);
    const planDigest = digest(plan);
    const existing = this.prepared.get(unitId);
    if (existing !== undefined)
      return existing.digest === planDigest
        ? { ok: true as const, prepared: { unitId, planDigest } }
        : { ok: false as const, code: "unit-conflict" as const, message: "unitId already prepared with a different plan" };
    const snapshot = await this.snapshot(plan, unitId, planDigest);
    const path = await writeUnitSnapshot(this.options.io, this.options.home, snapshot);
    const journal: UnitJournal = {
      schemaVersion: 1,
      unitId,
      runId: plan.runId,
      planDigest,
      target: plan.target,
      sources: plan.sources,
      phase: "prepared",
      storageKey: unitStorageKey(unitId),
      snapshotSha256: createHash("sha256")
        .update(JSON.stringify(snapshot, null, 2) + "\n")
        .digest("hex"),
      updatedAt: this.now(),
    };
    await writeUnitJournal(this.options.io, this.options.home, journal);
    await this.options.onPhase?.("prepared");
    this.prepared.set(unitId, {
      plan,
      digest: planDigest,
      at: this.now(),
      snapshotSha256: createHash("sha256")
        .update(JSON.stringify(snapshot, null, 2) + "\n")
        .digest("hex"),
    });
    void path;
    return { ok: true as const, prepared: { unitId, planDigest } };
  }

  async commit(
    prepared: UnitPrepared,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure> {
    const running = this.commits.get(prepared.unitId);
    if (running !== undefined) return await running;
    const task = this.commitOnce(prepared, options);
    this.commits.set(prepared.unitId, task);
    try {
      return await task;
    } finally {
      this.commits.delete(prepared.unitId);
    }
  }

  private async commitOnce(
    prepared: UnitPrepared,
    options?: { signal?: AbortSignal },
  ): Promise<{ ok: true; evidence: UnitEvidenceRecord } | UnitFailure> {
    const existing = await readUnitEvidence(this.options.io, this.options.home, prepared.unitId);
    if (existing !== null)
      return existing.planDigest === prepared.planDigest
        ? { ok: true as const, evidence: existing }
        : { ok: false as const, code: "unit-conflict" as const, message: "unit already committed with a different digest" };
    const stored = this.prepared.get(prepared.unitId);
    if (stored === undefined || stored.digest !== prepared.planDigest)
      return {
        ok: false as const,
        code: "unit-plan-missing" as const,
        message: "prepared plan is not in this process; manual recovery required",
      };
    if (options?.signal?.aborted === true)
      return { ok: false as const, code: "unit-commit-failed" as const, message: "cancelled before commit" };
    const journalBase = {
      schemaVersion: 1 as const,
      unitId: prepared.unitId,
      runId: stored.plan.runId,
      planDigest: stored.digest,
      target: stored.plan.target,
      sources: stored.plan.sources,
      storageKey: unitStorageKey(prepared.unitId),
      snapshotSha256: stored.snapshotSha256,
      updatedAt: this.now(),
    };
    let lock: TreeLock | undefined;
    let claim: UnitClaim | undefined;
    const checkpoints: UnitJournalCheckpoint[] = [];
    const writePhase = async (phase: UnitJournalPhase, checkpointsNext: UnitJournal["checkpoints"] = checkpoints) => {
      if (lock !== undefined && !(await lock.assertHeld())) throw new Error("unit-fence-lost");
      await writeUnitJournal(this.options.io, this.options.home, {
        ...journalBase,
        phase,
        checkpoints: checkpointsNext,
      });
      await this.options.onPhase?.(phase);
    };
    try {
      const acquired = await acquireTreeWriteLock({ io: this.options.io, home: this.options.home, waitMs: this.options.waitMs ?? 5000 });
      if (!acquired.ok) return { ok: false as const, code: "unit-fence-failed" as const, message: acquired.message ?? acquired.reason };
      lock = acquired.lock;
      if (!(await lock.assertHeld())) return { ok: false as const, code: "unit-fence-failed" as const, message: "tree fence lost" };
      this.options.onLock?.("tree");
      claim = await this.options.claim.acquire(stored.plan.target, stored.plan.runId);
      this.options.onLock?.("claim");
      await writeUnitJournal(this.options.io, this.options.home, { ...journalBase, phase: "target-pending" });
      const result = await this.options.backend.commit(
        { ...stored.plan, unitId: prepared.unitId },
        async (phase, detail) => {
          if (phase === "support-pending") {
            await writePhase("support-pending");
            await this.options.onPhase?.("support-pending" as never);
            return;
          }
          if (phase === "target-applied") {
            await this.options.onPhase?.("target-applied" as never);
            return;
          }
          if (phase === "unit-written") {
            if (lock !== undefined && !(await lock.assertHeld())) throw new Error("unit-fence-lost");
            await writeUnitReceipt(this.options.io, this.options.home, {
              schemaVersion: 1,
              unitId: prepared.unitId,
              runId: stored.plan.runId,
              planDigest: stored.digest,
              target: stored.plan.target,
              archived: stored.plan.sources.filter((source) => source !== stored.plan.target),
              at: this.now(),
            });
            await writePhase("unit-written");
            return;
          }
          if (phase === "source-archiving" && detail?.source !== undefined) {
            checkpoints.push({
              source: detail.source,
              phase: "archived",
              hash: createHash("sha256")
                .update(stored.plan.expectedSourceBodies.find((item) => item.name === detail.source)?.body ?? "")
                .digest("hex"),
              at: this.now(),
            });
          }
          await writePhase(phase, checkpoints);
        },
        options?.signal,
        async () => lock !== undefined && (await lock.assertHeld()),
      );
      if (!result.ok) {
        await writePhase("failed");
        return { ok: false as const, code: result.code ?? "unit-commit-failed", message: result.message };
      }
      const targetAfter = (await this.options.backend.readSkill(stored.plan.target)) ?? "";
      const evidence: UnitEvidenceRecord = {
        schemaVersion: 1,
        unitId: prepared.unitId,
        runId: stored.plan.runId,
        planDigest: stored.digest,
        state: "complete",
        target: {
          before: stored.plan.expectedTargetBody,
          after: targetAfter,
          supportDigest: createHash("sha256").update(JSON.stringify(stored.plan.supportFiles)).digest("hex"),
          created: !stored.plan.targetExists,
        },
        sources: stored.plan.sources
          .filter((source) => source !== stored.plan.target)
          .map((name) => ({
            name,
            before: stored.plan.expectedSourceBodies.find((item) => item.name === name)?.body ?? "",
            after: null,
            archived: (result.archived ?? []).includes(name),
            absorbedInto: stored.plan.target,
          })),
        mutations: result.mutations ?? 0,
        ...(stored.plan.validationPlan === undefined ? {} : { validationPlan: stored.plan.validationPlan }),
        at: this.now(),
      };
      if (!(await lock.assertHeld())) throw new Error("unit-fence-lost");
      const evidenceSha256 = evidenceDigest(evidence);
      await writeUnitEvidence(this.options.io, this.options.home, evidence);
      await writeUnitReceipt(this.options.io, this.options.home, {
        schemaVersion: 1, unitId: prepared.unitId, runId: stored.plan.runId, planDigest: stored.digest,
        target: stored.plan.target, archived: stored.plan.sources.filter((source) => source !== stored.plan.target), at: this.now(), evidenceSha256,
      });
      await writePhase("committed", checkpoints);
      this.prepared.delete(prepared.unitId);
      return { ok: true as const, evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false as const,
        code: message === "unit-fence-lost" ? ("unit-fence-failed" as const) : ("unit-claim-failed" as const),
        message,
      };
    } finally {
      await claim?.release();
      await lock?.release();
    }
  }

  async verify(ref: { unitId: string } | { runId: string }) {
    if ("unitId" in ref) return await readUnitEvidence(this.options.io, this.options.home, ref.unitId);
    const all = await Promise.all([...this.prepared.keys()].map(async (id) => readUnitEvidence(this.options.io, this.options.home, id)));
    const found = all.filter((item): item is UnitEvidenceRecord => item !== null && item.runId === ref.runId);
    const only = found[0];
    return found.length === 0 ? null : found.length === 1 ? (only ?? null) : found;
  }

  async finalize(unitId: string) {
    const existing = await readUnitEvidence(this.options.io, this.options.home, unitId);
    if (existing !== null) return { ok: true as const, evidence: existing };
    const snapshot = await readUnitSnapshot(this.options.io, this.options.home, unitId);
    const journal = await readUnitJournal(this.options.io, this.options.home, unitId);
    const receipt = await readUnitReceipt(this.options.io, this.options.home, unitId);
    if (snapshot === null || journal === null || (journal.phase !== "committed" && receipt === null))
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "unit is not committed; manual recovery required" };
    if (
      receipt !== null &&
      (receipt.unitId !== unitId ||
        receipt.runId !== snapshot.runId ||
        receipt.planDigest !== snapshot.planDigest ||
        receipt.target !== snapshot.target)
    )
      return {
        ok: false as const,
        code: "unit-rollback-blocked" as const,
        message: "unit receipt does not match snapshot; manual recovery required",
      };
    const checkpoints = journal.checkpoints ?? [];
    const missing = snapshot.sourceBefore.filter((source) => !checkpoints.some((item) => item.source === source.name));
    if (missing.length > 0)
      return {
        ok: false as const,
        code: "unit-rollback-blocked" as const,
        message: "source checkpoint missing: " + missing.map((item) => item.name).join(","),
      };
    const liveTarget = await this.options.backend.readSkill(snapshot.target);
    if (liveTarget === null || liveTarget !== (snapshot.targetAfter ?? null))
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "target live hash does not match the prepared target; manual recovery required" };
    const liveSources = await Promise.all(snapshot.sourceBefore.map(async source => ({ name: source.name, body: await this.options.backend.readSkill(source.name) })));
    const liveSource = liveSources.find(source => source.body !== null);
    if (liveSource !== undefined)
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "source is still live: " + liveSource.name };
    const liveSupport = await Promise.all(snapshot.supportAfter.map(async file => ({ path: file.path, content: await this.options.backend.readSupportFile(snapshot.target, file.path) })));
    if (liveSupport.some(file => file.content !== (snapshot.supportAfter.find(item => item.path === file.path)?.content ?? null)))
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "support file live hash does not match the prepared support; manual recovery required" };
    const evidence: UnitEvidenceRecord = {
      schemaVersion: 1,
      unitId,
      runId: snapshot.runId,
      planDigest: snapshot.planDigest,
      state: "complete",
      target: {
        before: snapshot.targetBefore,
        after: (await this.options.backend.readSkill(snapshot.target)) ?? "",
        supportDigest: createHash("sha256").update(JSON.stringify(snapshot.supportAfter)).digest("hex"),
        created: !snapshot.targetExists,
      },
      sources: snapshot.sourceBefore.map((source) => ({
        name: source.name,
        before: source.body,
        after: null,
        archived: checkpoints.some((item) => item.source === source.name),
        absorbedInto: snapshot.target,
      })),
      mutations: 0,
      ...(snapshot.validationPlan === undefined ? {} : { validationPlan: snapshot.validationPlan }),
      at: this.now(),
    };
    if (receipt?.evidenceSha256 !== undefined && evidenceDigest(evidence) !== receipt.evidenceSha256)
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "receipt evidence hash does not match rebuilt evidence" };
    await writeUnitEvidence(this.options.io, this.options.home, evidence);
    if (journal.phase !== "committed")
      await writeUnitJournal(this.options.io, this.options.home, { ...journal, phase: "committed", checkpoints, updatedAt: this.now() });
    return { ok: true as const, evidence };
  }

  async rollForward(unitId: string) {
    const existing = await readUnitEvidence(this.options.io, this.options.home, unitId);
    if (existing !== null) return { ok: true as const, evidence: existing };
    const snapshot = await readUnitSnapshot(this.options.io, this.options.home, unitId);
    const journal = await readUnitJournal(this.options.io, this.options.home, unitId);
    if (snapshot === null || journal === null || !["target-written", "support-pending", "source-archiving", "sources-archived", "unit-written"].includes(journal.phase))
      return {
        ok: false as const,
        code: "unit-rollback-blocked" as const,
        message: "unit is not roll-forwardable; manual recovery required",
      };
    const checkpoints = journal.checkpoints ?? [];
    const missing = snapshot.sourceBefore.filter((source) => !checkpoints.some((item) => item.source === source.name));
    if (missing.length > 0)
      return {
        ok: false as const,
        code: "unit-rollback-blocked" as const,
        message: "source checkpoint missing: " + missing.map((item) => item.name).join(","),
      };
    const targetAfter = await this.options.backend.readSkill(snapshot.target);
    if (targetAfter === null || targetAfter !== (snapshot.targetAfter ?? null))
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "target missing or drifted; manual recovery required" };
    const liveSources = await Promise.all(snapshot.sourceBefore.map(async source => ({ name: source.name, body: await this.options.backend.readSkill(source.name) })));
    const liveSource = liveSources.find(source => source.body !== null);
    if (liveSource !== undefined)
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "source is still live: " + liveSource.name };
    const liveSupport = await Promise.all(snapshot.supportAfter.map(async file => ({ path: file.path, content: await this.options.backend.readSupportFile(snapshot.target, file.path) })));
    if (liveSupport.some(file => file.content !== (snapshot.supportAfter.find(item => item.path === file.path)?.content ?? null)))
      return { ok: false as const, code: "unit-rollback-blocked" as const, message: "support file live hash does not match the prepared support; manual recovery required" };
    const evidence: UnitEvidenceRecord = {
      schemaVersion: 1,
      unitId,
      runId: snapshot.runId,
      planDigest: snapshot.planDigest,
      state: "complete",
      target: {
        before: snapshot.targetBefore,
        after: targetAfter,
        supportDigest: createHash("sha256").update(JSON.stringify(snapshot.supportAfter)).digest("hex"),
        created: !snapshot.targetExists,
      },
      sources: snapshot.sourceBefore.map((source) => ({
        name: source.name,
        before: source.body,
        after: null,
        archived: checkpoints.some((item) => item.source === source.name),
        absorbedInto: snapshot.target,
      })),
      mutations: 0,
      ...(snapshot.validationPlan === undefined ? {} : { validationPlan: snapshot.validationPlan }),
      at: this.now(),
    };
    await writeUnitEvidence(this.options.io, this.options.home, evidence);
    await writeUnitJournal(this.options.io, this.options.home, { ...journal, phase: "committed", checkpoints, updatedAt: this.now() });
    return { ok: true as const, evidence };
  }

  async rollback(ref: { unitId: string; reason: string }) {
    const evidence = await readUnitEvidence(this.options.io, this.options.home, ref.unitId);
    const receipt = await readUnitReceipt(this.options.io, this.options.home, ref.unitId);
    if (evidence !== null || receipt !== null)
      return { ok: false as const, code: "unit-committed" as const, message: "committed unit cannot roll back" };
    const snapshot = await readUnitSnapshot(this.options.io, this.options.home, ref.unitId);
    if (snapshot === null) return { ok: false as const, code: "unit-rollback-blocked" as const, message: "snapshot missing" };
    const journal = await readUnitJournal(this.options.io, this.options.home, ref.unitId);
    const acquired = await acquireTreeWriteLock({ io: this.options.io, home: this.options.home, waitMs: this.options.waitMs ?? 5000 });
    if (!acquired.ok) return { ok: false as const, code: "unit-fence-failed" as const, message: acquired.message ?? acquired.reason };
    let claim: UnitClaim | undefined;
    try {
      if (!(await acquired.lock.assertHeld()))
        return { ok: false as const, code: "unit-fence-failed" as const, message: "tree fence lost" };
      this.options.onLock?.("tree");
      claim = await this.options.claim.acquire(snapshot.target, snapshot.runId);
      this.options.onLock?.("claim");
      const currentTarget = await this.options.backend.readSkill(snapshot.target);
      if (currentTarget !== snapshot.targetBefore && currentTarget !== (snapshot.targetAfter ?? null))
        return {
          ok: false as const,
          code: "unit-rollback-blocked" as const,
          message: "target drifted since snapshot; manual recovery required",
        };
      for (const source of snapshot.sourceBefore) {
        const current = await this.options.backend.readSkill(source.name);
        if (current !== null && current !== source.body)
          return { ok: false as const, code: "unit-rollback-blocked" as const, message: "source drifted since snapshot: " + source.name };
      }
      if (!(await acquired.lock.assertHeld()))
        return { ok: false as const, code: "unit-fence-failed" as const, message: "tree fence lost before target restore" };
      await this.options.backend.restoreTarget(snapshot.target, snapshot.targetBefore);
      for (const file of snapshot.supportBefore) {
        if (!(await acquired.lock.assertHeld()))
          return { ok: false as const, code: "unit-fence-failed" as const, message: "tree fence lost before support restore" };
        await this.options.backend.restoreSupportFile?.(snapshot.target, file.path, file.content);
      }
      for (const source of snapshot.sourceBefore) {
        if (!(await acquired.lock.assertHeld()))
          return { ok: false as const, code: "unit-fence-failed" as const, message: "tree fence lost before source restore" };
        await this.options.backend.restoreSource(source.name, source.body);
      }
      if (journal !== null)
        await writeUnitJournal(this.options.io, this.options.home, { ...journal, phase: "rolled-back", updatedAt: this.now() });
      const evidenceRecord: UnitEvidenceRecord = {
        schemaVersion: 1,
        unitId: ref.unitId,
        runId: snapshot.runId,
        planDigest: snapshot.planDigest,
        state: "target-only",
        target: { before: snapshot.targetBefore, after: snapshot.targetBefore ?? "", supportDigest: "", created: false },
        sources: snapshot.sourceBefore.map((source) => ({
          name: source.name,
          before: source.body,
          after: null,
          archived: false,
          absorbedInto: snapshot.target,
        })),
        mutations: 0,
        at: this.now(),
      };
      return { ok: true as const, evidence: evidenceRecord };
    } finally {
      await claim?.release();
      await acquired.lock.release();
    }
  }

  async cancel(unitId: string, reason: string) {
    const journal = await readUnitJournal(this.options.io, this.options.home, unitId);
    if (journal === null) return { ok: false, phase: "none" as const };
    if (journal.phase === "prepared" && this.prepared.has(unitId)) {
      this.prepared.delete(unitId);
      return { ok: true, phase: "prepared" as const };
    }
    if (
      journal.phase === "target-pending" ||
      journal.phase === "target-written" ||
      journal.phase === "source-archiving" ||
      journal.phase === "sources-archived"
    ) {
      const rolled = await this.rollback({ unitId, reason });
      return { ok: rolled.ok, phase: journal.phase };
    }
    return { ok: false, phase: journal.phase };
  }
}
