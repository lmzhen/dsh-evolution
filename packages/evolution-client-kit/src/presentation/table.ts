/**
 * Responsive table contract shared by family panels.
 *
 * Markup: wrap any table in an element carrying data-evo-table-wrap. At a
 * narrow container (including a 200% browser zoom) the rows become stacked
 * definition blocks: rule/name on its own line, the metric on the next, so a
 * fixed numeric column can never squeeze a label to one character.
 */
export const RESPONSIVE_TABLE_CSS = [
  '[data-evo-table-wrap]{container-type:inline-size;}',
  '@container (max-width: 700px) {',
  '  [data-evo-table-wrap] table{display:block;width:100%;table-layout:auto;border:0;}',
  '  [data-evo-table-wrap] thead{display:none;}',
  '  [data-evo-table-wrap] tbody{display:flex;flex-direction:column;gap:var(--evo-space-4);}',
  '  [data-evo-table-wrap] tr{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--evo-space-2) var(--evo-space-8);padding:var(--evo-space-6) var(--evo-space-8);border:var(--evo-hairline-width) solid var(--dsw-alias-border-l1);border-radius:var(--evo-radius-control);}',
  '  [data-evo-table-wrap] td{display:block;padding:0;text-align:left;white-space:normal;overflow-wrap:anywhere;}',
  '  [data-evo-table-wrap] td[data-role="rule-name"], [data-evo-table-wrap] td[data-role="name"]{grid-column:1/-1;font-weight:500;}',
  '  [data-evo-table-wrap] td[data-role="rule-count"], [data-evo-table-wrap] td[data-role="count"]{grid-column:2;text-align:right;font-variant-numeric:tabular-nums;}',
  '  [data-evo-table-wrap] td[data-role="skills"]{grid-column:1/-1;}',
  '}',
].join(String.fromCharCode(10))
