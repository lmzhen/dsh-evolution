# New family event

Skeleton: `templates/event/producer-consumer.ts.tmpl`.

Family events are the `evolution/*` namespace on the platform's io/ctx buses
(`evolution/plan-applied`, `evolution/skill-signal`, …). The producer and its
consumer are ONE change: an emit with no reader is a dead channel, and a reader
with no producer never runs.

## Checklist

- [ ] Emit through the injected io surface (`io.emit('evolution/<name>', payload)`),
      never `ctx.emit` on a platform bus the family does not own.
- [ ] Ship the consumer in the same change, or register the event as an
      external-contract observation log with its reason. —
      *`verify-event-pairing.mjs` reports every emit with no `ctx.on`/`io.on`
      receiver (and counts camelCase receivers such as `ioCtx.on`).*
- [ ] Payload shape: name the fields the consumer reads; no platform objects.
- [ ] If the event can be produced per-turn, make sure it does not advance the
      review cadence — read names/counts from the normalizer, never the dispatch
      modality. — *`verify-arch-guards.mjs` N17 fails a `kind === 'program'`
      branch outside the owning module.*
- [ ] Durable events that only a deployment reads are registered as such. —
      *`verify-event-pairing.mjs` lists `feedback`/`learn`/`usage`/`maintain`
      as deliberate observation logs with reasons; add yours there.*
- [ ] Test both halves: a producer that fires, a consumer that reacts (with a
      temp home, never the real `DSH_HOME`).
