// SPDX-License-Identifier: Apache-2.0
// The one style sheet for the legallas-mcp pages, inlined in each page (CSP: style-src 'unsafe-inline' only).
// Token values are the light set from web/DESIGN.md sections 2 to 5 (the room is light only, the owner 2026-10-02); the room's self-hosted fonts are not served here,
// so the stacks fall back to system faces with a similar voice (a book serif, the platform sans, ui-monospace).

const TOKENS = `
:root{
color-scheme:light;
--paper:#FAF7F0;--panel:#F2EDE2;--surface:#FFFDF8;--ink:#1A1F1C;--ink-2:#4A524D;--ink-3:#666D68;
--forest:#1F3A2E;--forest-hover:#2E5A45;--forest-tint:#E3EBE5;--on-forest:#FAF7F0;--brass-rule:#A98B4F;
--oxblood:#6B1E23;--oxblood-tint:#F3E4E2;--rule:#D9CFBB;--border:#8A8272;--focus:#1F5FA8;
--font-serif:'Source Serif 4','Iowan Old Style','Charter','Georgia',serif;
--font-sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
--font-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
--radius:4px;--radius-chip:2px;--ease:cubic-bezier(0.2,0,0,1);--target:44px;
}
`;

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 0.875rem/1.25rem var(--font-sans);display:flex;flex-direction:column;min-height:100vh}
a{color:var(--forest);text-underline-offset:2px}
a:hover{color:var(--forest-hover)}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
h1,h2,h3{font-family:var(--font-serif);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:2.125rem;line-height:2.5rem}
h2{font-size:1.3125rem;line-height:1.75rem;margin-top:2rem}
p{margin:0.75rem 0 0}
.u-mono{font-family:var(--font-mono);font-size:0.8125rem;font-variant-numeric:tabular-nums}
time.u-mono{white-space:nowrap}
.u-quiet{color:var(--ink-3)}
.u-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.bar{background:var(--surface);border-bottom:1px solid var(--rule)}
.bar__inner,.page,.foot{width:100%;max-width:44rem;margin:0 auto;padding-left:1.5rem;padding-right:1.5rem}
.bar__inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.5rem 1.5rem;min-height:3.5rem}
.bar__brand{display:flex;align-items:center;gap:0.5rem;margin:0;font:600 1rem/1 var(--font-serif);color:var(--forest)}
.bar__brand span{color:var(--ink)}
.bar__seal{flex:none}
.bar__who{margin:0;color:var(--ink-2);font-size:0.8125rem;overflow-wrap:anywhere}
.bar__end{display:flex;flex-wrap:wrap;align-items:center;gap:0 1.5rem}
.bar__room{display:inline-flex;align-items:center;min-height:var(--target);font-weight:500}
.page{flex:1;padding-top:3rem;padding-bottom:3rem}
.lead{font:400 1.125rem/1.75rem var(--font-serif);color:var(--ink-2);max-width:66ch}
.prose{font:400 1rem/1.625rem var(--font-serif);max-width:66ch}
.prose ul{padding-left:1.25rem;margin:0.75rem 0 0}
.prose li+li{margin-top:0.375rem}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0.5rem 1.5rem;padding-top:1.5rem;padding-bottom:2rem;border-top:1px solid var(--rule);color:var(--ink-3);font-size:0.75rem;line-height:1rem}
.foot nav{display:flex;gap:1.5rem}
.foot a{display:inline-flex;align-items:center;min-height:var(--target);color:var(--ink-2)}
.foot p{margin:0;align-self:center}
@media (max-width:48rem){.bar__inner,.page,.foot{padding-left:1rem;padding-right:1rem}.page{padding-top:2rem}h1{font-size:1.625rem;line-height:2rem}}`;

const PARTS = `
.label{font:600 0.8125rem/1.125rem var(--font-sans);font-variant-caps:all-small-caps;letter-spacing:0.04em;color:var(--ink-2);margin:0}
.dest{margin-top:2rem;background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--forest);border-radius:var(--radius);padding:1.25rem 1.5rem}
.dest__row+.dest__row{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--rule)}
.dest__value{margin:0.25rem 0 0;font:500 1.3125rem/1.75rem var(--font-mono);overflow-wrap:anywhere}
.dest__name{margin:0.25rem 0 0;font:600 1.3125rem/1.75rem var(--font-serif);overflow-wrap:anywhere}
.dest__note{margin:0.25rem 0 0;color:var(--ink-2);font-size:0.8125rem;line-height:1.125rem}
.verified{display:inline-flex;align-items:center;gap:0.375rem;margin:0.5rem 0 0;padding:0.125rem 0.5rem;border:1px solid var(--forest);border-radius:var(--radius-chip);background:var(--forest-tint);color:var(--forest);font-size:0.8125rem;line-height:1.125rem}
.warn{display:grid;grid-template-columns:1.25rem 1fr;gap:0.5rem;margin-top:1rem;padding:0.75rem 1rem;border:1px solid var(--oxblood);border-radius:var(--radius);background:var(--surface);color:var(--ink);font-size:0.875rem;line-height:1.375rem;max-width:66ch}
.warn svg{margin-top:0.1875rem;color:var(--oxblood)}
.warn p{margin:0}
.warn strong{display:block}
.signed{margin-top:0.5rem;color:var(--ink-2)}
.signed strong{color:var(--ink);overflow-wrap:anywhere}
.toggle{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:1.5rem}
.toggle a{display:inline-flex;align-items:center;min-height:var(--target);padding:0 0.875rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--ink);text-decoration:none;font-weight:500}
.toggle a[aria-current="page"]{background:var(--forest-tint);border-color:var(--forest);color:var(--forest);font-weight:600}
.more{margin-top:1rem}
.facts{margin:0.75rem 0 0;padding:0;list-style:none;max-width:66ch}
.facts li{display:grid;grid-template-columns:1.25rem 1fr;gap:0.5rem;padding:0.625rem 0;border-top:1px solid var(--rule);font:400 1rem/1.5rem var(--font-serif)}
.facts li:last-child{border-bottom:1px solid var(--rule)}
.facts svg{margin-top:0.25rem;color:var(--forest)}
.actions{display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:2rem}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:var(--target);min-width:var(--target);padding:0 1.25rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--ink);font:600 0.875rem/1 var(--font-sans);text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--ink-2)}
.btn--primary{background:var(--forest);border-color:var(--forest);color:var(--on-forest)}
.btn--primary:hover{background:var(--forest-hover);border-color:var(--forest-hover);color:var(--on-forest)}
.btn--small{min-height:var(--target);padding:0 0.875rem;font-weight:500}
.fine{margin-top:1.5rem;color:var(--ink-3);font-size:0.75rem;line-height:1rem;max-width:66ch}
.notice{margin-top:1.5rem;padding:0.75rem 1rem;border:1px solid var(--forest);border-radius:var(--radius);background:var(--forest-tint);color:var(--ink)}
.table-wrap{margin-top:1.5rem;overflow-x:auto;border:1px solid var(--rule);border-radius:var(--radius);background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:0.875rem}
th{background:var(--panel);text-align:left;font-weight:600;padding:0.5rem 0.75rem;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:0.25rem 0.75rem;border-top:1px solid var(--rule);height:3.25rem;vertical-align:middle;color:var(--ink-2)}
td:first-child{color:var(--ink);font-weight:600;min-width:9rem;overflow-wrap:break-word}
.cell-wrap{word-break:break-all;min-width:12rem}
td form{margin:0}
.cell-end{text-align:right}
.empty{margin-top:1.5rem;padding:2rem 1.5rem;border:1px dashed var(--border);border-radius:var(--radius);background:var(--surface);font:400 1rem/1.5rem var(--font-serif);color:var(--ink-2)}
.field{display:grid;gap:0.375rem;margin-top:1rem;max-width:32rem}
.field label{font-weight:600}
.field small{color:var(--ink-3);font-size:0.75rem;line-height:1rem}
.input{min-height:var(--target);padding:0.625rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--ink);font:400 0.875rem/1.25rem var(--font-sans)}
textarea.input{font-family:var(--font-mono);font-size:0.8125rem;resize:vertical}
.secret{margin-top:1.5rem;padding:1.25rem 1.5rem;border:1px solid var(--forest);border-top-width:3px;border-radius:var(--radius);background:var(--surface)}
.secret h2{margin-top:0}
.secret .label{margin-top:1rem}
.secret code{display:block;margin-top:0.25rem;padding:0.5rem 0.75rem;background:var(--panel);border-radius:var(--radius);font:500 0.875rem/1.375rem var(--font-mono);overflow-wrap:anywhere;user-select:all}
.code{font:600 0.8125rem/1 var(--font-mono);color:var(--ink-3)}
@media (max-width:40rem){thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
tr{display:block;padding:0.75rem 1rem;border-top:1px solid var(--rule)}
tr:first-child{border-top:0}
td{display:flex;gap:0.75rem;align-items:baseline;height:auto;padding:0.25rem 0;border:0;min-width:0}
td[data-label]::before{content:attr(data-label);flex:none;width:6.5rem;color:var(--ink-3);font-size:0.75rem}
.cell-end{text-align:left;padding-top:0.5rem}}
@media (prefers-reduced-motion:no-preference){.btn,a{transition:background-color 120ms var(--ease),border-color 120ms var(--ease),color 120ms var(--ease)}}
@media (forced-colors:active){.btn,.dest,.warn,.verified,.secret,.input{border-color:CanvasText}}
@media print{.bar,.foot nav,.actions{display:none}}`;

/** The inline style sheet every page carries. */
export const STYLES = (TOKENS + BASE + PARTS).replace(/\n/g, '');
