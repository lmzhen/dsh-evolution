# @deepseek-ai/dsh-evolution-ui

Web UI umbrella for the evolution family. The settings panel now lives here; merge and skill-history still delegate to their packages until their client code moves.

## Known Limitations and Deferred Work

- Merge and skill-history are still dependencies and their panels are mounted through their `apply` exports.
- The skill-health panel stays a separate disabled row; it is not enabled by this umbrella.
