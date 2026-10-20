export const CSS_TAG_ID = 'evolution-merge-panel'

export const CSS = [
  '.' + CSS_TAG_ID + ' { display:flex; flex-direction:column; gap:12px; padding:16px; }',
  '.' + CSS_TAG_ID + ' [data-role="hint"] { margin:0; color:var(--dsh-text-muted,#666); font-size:12px; }',
  '.' + CSS_TAG_ID + ' [data-role="stats"] { display:flex; gap:8px; flex-wrap:wrap; }',
  '.' + CSS_TAG_ID + ' [data-role="stat"] { border:1px solid var(--dsh-border,#ddd); border-radius:6px; padding:6px 10px; min-width:64px; }',
  '.' + CSS_TAG_ID + ' [data-role="stat-value"] { font-size:20px; font-weight:600; }',
  '.' + CSS_TAG_ID + ' [data-role="stat-label"] { font-size:11px; color:var(--dsh-text-muted,#666); }',
  '.' + CSS_TAG_ID + ' [data-role="tabs"] { display:flex; gap:6px; border-bottom:1px solid var(--dsh-border,#ddd); }',
  '.' + CSS_TAG_ID + ' [data-role="tab"] { background:none; border:0; border-bottom:2px solid transparent; padding:6px 8px; cursor:pointer; color:inherit; }',
  '.' + CSS_TAG_ID + ' [data-role="tab"][data-active="true"] { border-bottom-color:var(--dsh-accent,#3b82f6); }',
  '.' + CSS_TAG_ID + ' [data-role="rows"] { display:flex; flex-direction:column; gap:6px; }',
  '.' + CSS_TAG_ID + ' [data-role="row"] { display:grid; grid-template-columns:1fr auto; gap:8px; padding:8px; border:1px solid var(--dsh-border,#ddd); border-radius:6px; }',
  '.' + CSS_TAG_ID + ' [data-role="row-label"] { font-weight:600; }',
  '.' + CSS_TAG_ID + ' [data-role="row-meta"] { color:var(--dsh-text-muted,#666); font-size:12px; }',
  '.' + CSS_TAG_ID + ' [data-role="note"] { color:var(--dsh-text-muted,#666); font-size:12px; }',
  '.' + CSS_TAG_ID + ' [data-role="refresh"] { align-self:flex-start; }',
].join('\n')
