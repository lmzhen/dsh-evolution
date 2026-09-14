# New session-level consumer

Skeleton: `templates/event/producer-consumer.ts.tmpl`.

A consumer that subscribes to `session/event` acts on sessions the family may
never have been mounted into (the 0.3.77 C-axis incident: review injected prompts
into original-preset sessions and skill-usage counted their reads). The five
rules below already existed; this is the one place that says "copy these when you
add a consumer".

## Checklist

- [ ] **First line of the listener** asks the opt-in gate:
      `if (!sessionAudited(ctx, session.id, config.sessionScoped)) return`. —
      *`verify-arch-guards.mjs` N18 fails an ungated `session/event` listener; a
      deliberate exception is registered in `SESSION_GATE_REGISTER` with reason.*
- [ ] Declare `sessionScoped` in the row's Config (default `false` = historical
      behaviour) and set `sessionScoped: true` on the cross-session rows of the
      three bundles, byte-identically. — *`bundle-mutual-exclusion.spec.ts` (E-33).*
- [ ] Platform **registry reads** pass the calling scope:
      `catalog.list({ scope: callingScope(ctx) })`. — *N16 fails a scope-less read;
      registered global reads live in `SCOPE_READ_REGISTER`.*
- [ ] **Durable reads** distinguish three states — use `Probe<T>` from
      `evolution-core/src/probe.ts` (present / absent / unknown). — *N14 fails a
      `catch` that serves a read failure as absent; `SWALLOW_CATCH` is the
      register.*
- [ ] **Delivery** goes through the waking primitive on the receiver
      (`agent.followup(...)` / `deliverEnsuringWake`), never a detached
      reference. — *N13b fails a wake primitive read into a local (0.3.73: six
      days of silently eaten review prompts); N13a fails `agent.inject` for a
      must-execute payload.*
- [ ] **Module-scope state** (a `Set`/`Map` the file writes) is registered in
      `MUTABLE_STATE` with its platform gap, lifecycle owner, test anchor and
      validity domain. — *N12 fails an unregistered store.*
- [ ] **Modality-blind**: read `ToolDispatchSignal` names/counts, never
      `signal.kind`. — *N17.*
- [ ] Writes go through `transact` (file lock) if the sidecar is shared; the
      single-process assumption is registered, not implied.
- [ ] Test the gate both ways: an original-preset session is skipped, a family
      session is served (see `evolution-core/tests/opt-in.spec.ts`).
