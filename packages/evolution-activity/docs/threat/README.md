# @lmzhen/dsh-evolution-threat

Write-time threat guard for the family model-writing tools. It is enabled by default and runs even when ordinary write approval is disabled.

## Actual coverage

The guard scans calls whose tool name belongs to the family `EVOLUTION_WRITE_TOOLS` set. Memory calls scan `facts` and `content`, including entries in `operations[]`; skill calls scan `content`, `file_content`, and `new_string`. A matching threat label denies the allowed execution through `tools.guard`.

This is not a scan of every internal write. Curator jobs, merge orchestration, direct provider calls, generic file tools, and other paths outside the guarded tool set are not covered by this package.

## Configuration and limits

- `enabled`: mounts the guard; default `true`.
- `maxScanChars`: normalized characters scanned per field; default 65,536. Values below the overlap-safe floor fall back to the default.
- `threatExemptLabels`: deployment-declared benign labels; default empty. These labels affect the scan and must be treated as security configuration.

The rule set is manually maintained and is not exhaustive. It is one write-control layer, not a general sandbox or a guarantee that every secret, injection, or exfiltration attempt will be detected.
