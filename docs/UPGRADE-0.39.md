# Upgrade to 0.39.0

## Review mode

`reviewMode: branch` is removed. The review now defaults to `aux`:

- parent request prefix reused;
- parent Agent, no child Session;
- allowlisted parent-visible tools executed without a log;
- no review prompt/tool append to the parent Session;
- result text stays in the bounded activity review record.

Before restarting, change every profile patch or settings value:

```yaml
reviewMode: aux
```

The closed config union rejects `branch` at load. If you leave the old value, the policy plugin fails validation and deactivates.

`inject` remains only as a debug/compatibility mode; it writes the review into the parent conversation.

## Old branch records

Old activity records with `branchSessionId` remain readable; the field is no longer produced. Old child Session logs are read-only historical data and are not rewritten or deleted.

## PTC sessions

PTC parent headers expose only `run_code`. Aux review refuses it to preserve parent no-append, so PTC reviews can be empty or degraded. Use a standard Agent preset for semantic review; do not treat a PTC empty review as a successful review.

## Result notices

Aux results are audit-only. `reviewNotice` affects the inject path; it does not add aux output to the parent conversation.
