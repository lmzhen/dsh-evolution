export const CSS_TAG_ID = 'evolution-merge-panel'

export const CSS = [
  '.' + CSS_TAG_ID + ' { display:flex; flex-direction:column; gap:var(--evo-space-12); padding:var(--evo-space-16); }',
  '.' + CSS_TAG_ID + ' [data-role="hint"] { margin:0; color:var(--dsw-alias-label-tertiary); font-size:var(--evo-type-xs); }',
  '.' + CSS_TAG_ID + ' [data-role="stats"] { display:flex; gap:var(--evo-space-8); flex-wrap:wrap; }',
  '.' + CSS_TAG_ID + ' [data-role="stat"] { border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2); border-radius:var(--evo-radius-control); padding:var(--evo-space-6) var(--evo-space-10); min-width:calc(var(--evo-space-16) * 4); }',
  '.' + CSS_TAG_ID + ' [data-role="stat-value"] { font-size:var(--evo-type-lg); font-weight:600; }',
  '.' + CSS_TAG_ID + ' [data-role="stat-label"] { font-size:var(--evo-type-xs); color:var(--dsw-alias-label-tertiary); }',
  '.' + CSS_TAG_ID + ' [data-role="tabs"] { display:flex; gap:var(--evo-space-6); border-bottom:var(--evo-hairline-width) solid var(--dsw-alias-border-l2); }',
  '.' + CSS_TAG_ID + ' [data-role="tab"] { background:none; border:0; border-bottom:var(--evo-hairline-width) solid transparent; padding:var(--evo-space-6) var(--evo-space-8); cursor:pointer; color:inherit; }',
  '.' + CSS_TAG_ID + ' [data-role="tab"][data-active="true"] { border-bottom-color:var(--dsw-alias-brand-primary); }',
  '.' + CSS_TAG_ID + ' [data-role="rows"] { display:flex; flex-direction:column; gap:var(--evo-space-6); }',
  '.' + CSS_TAG_ID + ' [data-role="row"] { display:grid; grid-template-columns:1fr auto; gap:var(--evo-space-8); padding:var(--evo-space-8); border:var(--evo-hairline-width) solid var(--dsw-alias-border-l2); border-radius:var(--evo-radius-control); }',
  '.' + CSS_TAG_ID + ' [data-role="row-label"] { font-weight:600; }',
  '.' + CSS_TAG_ID + ' [data-role="row-meta"] { color:var(--dsw-alias-label-tertiary); font-size:var(--evo-type-xs); }',
  '.' + CSS_TAG_ID + ' [data-role="note"] { color:var(--dsw-alias-label-tertiary); font-size:var(--evo-type-xs); }',
  '.' + CSS_TAG_ID + ' [data-role="refresh"] { align-self:flex-start; }',
].join('\n')
