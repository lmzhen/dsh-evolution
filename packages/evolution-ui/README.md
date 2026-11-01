# @deepseek-ai/dsh-evolution-ui

Web UI umbrella for the evolution family. It mounts the settings, skill-history and merge panels from their existing packages while their client code is migrated here.

## Known Limitations and Deferred Work

- The umbrella currently delegates to the three legacy UI packages; they stay as dependencies until each panel is moved and its old package removed.
- The skill-health panel stays a separate disabled row; it is not enabled by this umbrella.
