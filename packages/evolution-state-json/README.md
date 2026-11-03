# @lmzhen/dsh-evolution-state-json

Default JSON state provider over the family IO seam. It stores review, curator, and pending records without requiring the platform storage-domain service.

`root` defaults to the evolution home. The principal files are `review-state.json`, `curator-state.json`, and `pending-state.json`; the pre-split `pending.json` is read-only legacy input that is retired after migration.

## Retention and corruption behavior

Resolved pending records are capped at 200 in the live map. Older records move to `pending-state-archive.json`, whose own history rotates to a `.bak` sidecar after 5,000 records. Pending/executing work is not trimmed by the resolved cap. Review cadence state is capped at 500 sessions.

Malformed state is not accepted as an empty store. The provider preserves the original bytes in a `.corrupt` copy when possible and fails loudly so a later save cannot silently overwrite recoverable state. Quarantine copies have a bounded rescue window handled by the Node IO backend.

Read-modify-write safety depends on the selected IO backend. The shipped Node backend serializes within one process only; see [evolution-io-node](../evolution-io-node/README.md) before sharing one home between processes.
