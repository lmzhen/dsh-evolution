# @lmzhen/dsh-evolution-client-kit

Internal browser-only library shared by the evolution sidebar panels. It is not a plugin row and exposes no command, panel, or model tool of its own.

It owns the client seam types, sidebar registration lifecycle, workspace identity, route/client contracts, fallback command metadata, generated state types, and design tokens. Panel packages consume these exports instead of carrying separate copies.

Files under `src/generated/` and the generated token surfaces are derived from their owning sources. Do not hand-edit them; update the source and rerun the corresponding generator.
