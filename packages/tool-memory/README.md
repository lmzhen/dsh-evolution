# @deepseek-ai/dsh-tool-memory

Model-facing memory tool and prompt context

## Model Experience

### Memory tool and runtime snapshot

#### What the model sees

The model sees the `memory` tool schema, one fixed guidance section, and a runtime snapshot containing the current memory entries.

#### Token effect

Fixed guidance has a constant token cost. The runtime snapshot scales with stored memory entries and is absent when memory is empty.

#### KV Cache effect

Guidance text is prefix-stable. The runtime snapshot is replaced after successful memory writes and is otherwise unchanged between requests.

## Known Limitations and Deferred Work


- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.
