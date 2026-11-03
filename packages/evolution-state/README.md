# @lmzhen/dsh-evolution-state

State facade consumed by review, curator, and approval services. It owns no medium and performs no file or domain IO itself.

`provider` can pin a registered backend by name; empty selects the sole/first registered provider. If more than one provider is mounted without a pin, the facade throws instead of silently rebinding state according to registration order. A named provider that is not registered also fails loudly.

Use [evolution-state-json](../evolution-state-json/README.md) for the default local provider or [evolution-state-domain](../evolution-state-domain/README.md) for an explicitly configured domain backend. There is no direct command, panel, or model tool on this facade.
