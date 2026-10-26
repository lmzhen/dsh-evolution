# @lmzhen/dsh-evolution-client-kit

Browser-side seams and lifecycle shared by the evolution family's sidebar panels.
It owns the client contract types, generated route/state/contract tables, design tokens, and
one `registerSidebarPanel` entry point that installs the locale, stylesheet, row, and keyed
main body. It is a library, not a plugin row: it declares no `dsh.client` entry.

Feature panels keep their own Panel/Store/api and icon; only the platform-facing lifecycle
lives here. settings-ui keeps its settings-section lifecycle, but shares the generated tables.
