# @lmzhen/dsh-tool-memory

Model-facing `memory` tool plus durable-memory guidance and snapshot sections for the system prompt.

## Tool contract

`target` selects `memory` for agent notes or `user` for stable user-profile facts. Actions are `add`, `replace`, and `remove`. `facts` and `content` are aliases; supplying different non-blank values for both is rejected.

Use one `operations` array for a batch. The batch is evaluated against the final result so removal/replacement can free budget before additions. Add requires content; replace requires matching old text and new content; remove requires matching old text. Empty batches and malformed operations are rejected before approval.

## Defaults and boundaries

- `memoryEnabled`: default `true`; disabling removes the model tool and prompt sections while retaining an explicit refusal runner for previously staged writes.
- `entryPreviewChars`: default 200 characters per entry in the tool response; this does not truncate stored content.
- `memoryChars` and `userChars`: enforced by the selected provider, not by this tool; see [memory-files](../memory-files/README.md).

When ordinary approval is enabled, a write can return `pending_id` instead of executing immediately. An effective platform session policy of `never` bypasses staging as designed.

Guidance and snapshot injection require the optional `systemPrompt` service. Without it, the write tool still works but memory context is not injected. Successful writes through the memory registry refresh the snapshot, including graph and background-review writes.
