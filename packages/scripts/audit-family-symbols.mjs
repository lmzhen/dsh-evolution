#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const args=process.argv.slice(2); const value=n=>{const i=args.indexOf(n);return i===-1?undefined:args[i+1]}
const from=value('--from'),to=value('--to'),installed=value('--installed')
if(!from||!to) throw new Error('usage: audit-family-symbols.mjs --from <overlay> --to <mirror> [--installed <node_modules/@lmzhen>]')
const PKG={'evolution-core':'dsh-evolution-core','tool-skill-manage':'dsh-tool-skill-manage','evolution-skill-health':'dsh-evolution-skill-health','evolution-skill-history':'dsh-evolution-skill-history','evolution-merge-engine':'dsh-evolution-merge-engine'}
const SYMBOLS={'evolution-core':['buildExtractPlanFromLibrary','MutationUnit','EXTRACT_PROMPT_HASH'],'tool-skill-manage':['neededOwner'],'evolution-skill-health':['healthy'],'evolution-skill-history':['undoUnit'],'evolution-merge-engine':['whenToUse','headExtract']}
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=join(dir,e.name);if(e.isDirectory())out.push(...await files(p));else if(/[.](mjs|cjs|js|ts|tsx)$/.test(e.name))out.push(p)}return out}
async function counts(dir){const result={};for(const s of Object.values(SYMBOLS).flat())result[s]=0;for(const f of await files(dir)){const t=await readFile(f,'utf8');for(const s of Object.keys(result))result[s]+=t.split(s).length-1}return result}
const roots=[['overlay',from],['mirror',to]];if(installed)roots.push(['installed',installed])
const table={};for(const [label,root] of roots){table[label]={};for(const pkg of Object.keys(SYMBOLS)){const path=label==='installed'?join(root,PKG[pkg]):join(root,pkg);try{table[label][pkg]=await counts(path)}catch{table[label][pkg]=null}}}
let failed=false
for(const pkg of Object.keys(SYMBOLS)){for(const symbol of SYMBOLS[pkg]){const o=table.overlay[pkg]?.[symbol]??0,m=table.mirror[pkg]?.[symbol]??0,i=installed?(table.installed[pkg]?.[symbol]??0):undefined;const ok=o>0&&m>0&&(i===undefined||i>0);console.log((ok?'OK ':'MISS ')+pkg+' '+symbol+' overlay='+o+' mirror='+m+(i===undefined?'':' installed='+i));if(!ok)failed=true}}
if(failed)process.exitCode=1
