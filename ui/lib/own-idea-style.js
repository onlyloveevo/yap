// Runtime layout for a person's own idea; the approved shell files stay unchanged.
// Every rule is scoped to html[data-own-idea="true"], which ui/lib/idea-wire.js
// sets outside shell mode, and is built from the shell's own tokens.
const RULES = `
[hidden] { display:none !important; }

/* The conversation grows with the person's words and scrolls inside its panel. */
.thread { overflow-y:auto; overscroll-behavior:contain; justify-content:flex-start; padding-right:8px; scrollbar-width:thin; scrollbar-color:var(--rule) transparent; }
.thread > * { flex-shrink:0; }
.thread.scrolled { -webkit-mask-image:linear-gradient(to bottom, transparent 0, #000 24px); mask-image:linear-gradient(to bottom, transparent 0, #000 24px); }
.thread p { overflow-wrap:anywhere; }
.talk > .box, .talk > button { flex-shrink:0; }
.coach-by { margin:0; padding:0 0 12px 6px; font-size:13px; line-height:1.3; letter-spacing:.02em; color:var(--white-dim); }
.thinking { display:inline-flex; align-items:center; gap:6px; height:1.45em; }
.thinking i { width:7px; height:7px; border-radius:50%; background:var(--amber); opacity:.3; animation:coach-dot 1.2s ease-in-out infinite; }
.thinking i:nth-child(2) { animation-delay:.2s; }
.thinking i:nth-child(3) { animation-delay:.4s; }
@media (prefers-reduced-motion: reduce) { .thinking i { animation:none; opacity:.6; } }
button:disabled { cursor:default; }

/* First conversation: the starting thought, where it is headed, and the formats. */
.idea:has([data-testid="keep-exploring"]) { overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
.idea > :not(.cols) { flex-shrink:0; }
.thought { overflow-wrap:anywhere; }
.tpl { cursor:pointer; position:relative; }
.tpl[aria-expanded="true"] .chev { transform:rotate(180deg); }
.idea { position:relative; }
.tpl-menu { position:absolute; z-index:6; display:flex; flex-direction:column; gap:2px; padding:6px; border:1px solid var(--card-border); border-radius:var(--radius-card); background:rgba(24,20,16,.96); box-shadow:0 18px 40px rgba(0,0,0,.45); }
.tpl-option { display:grid; grid-template-columns:auto auto 1fr auto; align-items:center; gap:12px; padding:10px 14px; border:0; border-radius:10px; background:transparent; color:var(--white); text-align:left; font-size:16px; }
.tpl-option:hover, .tpl-option:focus-visible { background:rgba(255,255,255,.07); outline:none; }
.tpl-option[aria-selected="true"] { background:var(--amber-tint); }
.tpl-option .dot { width:10px; height:10px; border-radius:50%; border:1px solid rgba(255,255,255,.35); }
.tpl-option .t { font-weight:600; }
.tpl-option .s { color:var(--white-dim); font-size:14.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tpl-option .a { color:var(--white-soft); font-size:13px; letter-spacing:.04em; }
.formats.all { grid-template-columns:1fr 1fr 1fr; gap:var(--space-3); }
.formats.all .fmt { flex-direction:column; align-items:flex-start; justify-content:center; padding:0 var(--space-4); }
.formats.all .fmt svg { display:none; }
.formats.all .fmt { height:96px; gap:var(--space-4); }
.formats.all .fmt svg { width:40px; height:40px; }
.formats.all .fmt .s { margin-top:var(--space-1); font-size:15px; }
.formats.all .fmt.th .txt { margin-top:0; }
.formats.all .fmt.th .pill { position:absolute; top:10px; right:12px; margin:0; font-size:12px; }
.fmt[aria-pressed="true"] svg { color:var(--amber); }

/* Shaping: the story so far beside the formats. */
.story { overflow-y:auto; overscroll-behavior:contain; min-height:0; padding-bottom:10px; }
.story .lbl, .story .beat { overflow-wrap:anywhere; }
.story textarea.beat { display:block; width:100%; resize:none; border-color:var(--amber); color:var(--white); font:inherit; }
.story textarea.beat:focus { outline:none; box-shadow:0 0 14px var(--amber-tint); }
[data-testid="edit-story"][hidden] + .pencil { display:none; }
.story-head .ulink { cursor:pointer; }
.thumbs { overflow-y:auto; overscroll-behavior:contain; padding:var(--space-3) 6px 6px var(--space-4); }
.fpick { flex:none; display:flex; align-items:center; gap:14px; width:100%; margin-top:var(--space-2); padding:8px 14px; border:1px solid var(--rule); border-radius:var(--radius-nav); background:var(--field); color:var(--white); text-align:left; }
.fpick svg { flex:none; width:26px; height:26px; stroke-width:1.5; color:var(--white-soft); }
.fpick .t { display:block; font-size:16.5px; font-weight:600; }
.fpick .s { display:block; margin-top:3px; font-size:14px; line-height:1.35; color:var(--white-soft); }
.fpick[aria-pressed="true"] { border:1.5px solid var(--amber); box-shadow:0 0 18px var(--amber-tint); }
.fpick[aria-pressed="true"] svg { color:var(--amber); }
.why { margin:6px 0 2px; font-size:14px; line-height:1.4; color:var(--white-dim); }
.cols { grid-template-rows:minmax(0, 1fr); }
/* A thumbnail direction is a 16 by 9 card: a picture where one was made for the idea, type where it was not. Two fill the column, whatever its height. */
.thumbs.pictures { container-type:size; overflow:hidden; }
.thumbs.pictures > * { flex:none; }
.thumbs.pictures .thumb { flex:none; align-self:flex-start; width:auto; max-width:100%; aspect-ratio:16 / 9; height:min(calc((100cqh - 138px) / 2), calc(100cqw * 9 / 16)); cursor:pointer; }
.thumbs.pictures .thumb img { width:100%; height:100%; aspect-ratio:auto; object-fit:cover; }
.thumb.type { position:relative; display:flex; align-items:center; padding:0 7%; line-height:1; text-align:left; background:radial-gradient(38% 60% at 82% 30%, rgba(214,132,44,.5), transparent 70%), radial-gradient(30% 46% at 66% 82%, rgba(176,98,30,.42), transparent 72%), radial-gradient(24% 40% at 96% 88%, rgba(244,198,107,.3), transparent 70%), linear-gradient(115deg, #17110b 0%, #2a1b0e 55%, #3a2410 100%); }
.thumb.type .tw { display:flex; flex-direction:column; align-items:flex-start; gap:.04em; font-family:"Avenir Next Condensed", "HelveticaNeue-CondensedBlack", "Arial Narrow", Impact, sans-serif; font-weight:800; line-height:.98; letter-spacing:.005em; text-transform:uppercase; white-space:nowrap; text-shadow:0 3px 14px rgba(0,0,0,.55); }
.thumb.type .l1 { color:var(--white); }
.thumb.type .l2 { position:relative; color:var(--amber); padding-bottom:.16em; }
.thumb.type .l2::after { content:""; position:absolute; left:-2%; right:-4%; bottom:0; height:.07em; border-radius:999px; background:var(--amber); transform:rotate(-1.6deg); }
[data-testid="thumb-b"].type { justify-content:flex-end; background:radial-gradient(36% 58% at 16% 34%, rgba(214,132,44,.5), transparent 70%), radial-gradient(28% 44% at 34% 84%, rgba(176,98,30,.42), transparent 72%), linear-gradient(245deg, #17110b 0%, #2a1b0e 55%, #3a2410 100%); }
[data-testid="thumb-b"].type .tw { transform:rotate(-4deg); }
.thumb.line { display:block; padding:14px 16px; line-height:1.3; text-align:left; cursor:pointer; background:var(--field); }
.thumb.line .ln { font-size:clamp(16px, 1.3vw, 19px); font-weight:600; color:var(--white); overflow-wrap:anywhere; }
.sample-tag { padding:2px 10px; border:1px solid var(--rule); border-radius:var(--radius-pill); font-size:12px; letter-spacing:.04em; color:var(--white-dim); }
.thumbs .cap { color:var(--white); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* A story longer than its column tightens, then shows the first lines of each box. Nothing is cut by the panel's edge. */
.story .beat .bt { display:block; }
.story[data-fit="1"] .lbl, .story[data-fit="2"] .lbl, .story[data-fit="3"] .lbl { margin:1.2vh 0 4px; font-size:15.5px; }
.story[data-fit="1"] .beat, .story[data-fit="2"] .beat, .story[data-fit="3"] .beat { min-height:0; padding:10px 14px; font-size:15.5px; line-height:1.38; }
.story[data-fit="2"] .beat .bt, .story[data-fit="3"] .beat .bt { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden; }
.story[data-fit="3"] .beat .bt { -webkit-line-clamp:2; }
/* First conversation: who is answering sits at the foot of the thread, under the one quiet line YAP says. */
.msg-yap ~ .coach-by { margin-top:auto; }
.thumbs .dir { color:var(--white-soft); }
.headed { margin-top:var(--space-3) !important; }
.places { flex:none; }
.places { display:flex; flex-wrap:wrap; gap:8px; margin-top:var(--space-2); }
.place { padding:7px 12px; border:1px solid var(--rule); border-radius:var(--radius-pill); background:transparent; color:var(--white-soft); font-size:14px; }
.place[aria-pressed="true"] { border-color:var(--amber); color:var(--amber); background:var(--amber-tint); }
.exp-list { display:flex; flex-direction:column; gap:8px; margin-top:8px; max-height:22vh; overflow-y:auto; }
.exp-row { display:flex; align-items:center; gap:var(--space-4); padding:10px 14px 10px var(--space-5); border:1px solid var(--rule); border-radius:var(--radius-nav); background:var(--field); }
.exp-words { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.exp-words .t { font-size:16px; font-weight:500; overflow-wrap:anywhere; }
.exp-words .s { font-size:13.5px; color:var(--white-dim); }
.exp-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.exp-text { min-width:0; }
.foot .actions { align-items:center; gap:var(--space-8); margin-top:var(--space-3); }
.foot .actions .keep { margin-left:auto; margin-right:0; padding-bottom:0; }

/* The draft: a title card where the shell drew a thumbnail, then the beats. */
.titlecard { flex:0 0 auto; display:flex; flex-direction:column; justify-content:flex-end; gap:10px; min-height:21vh; margin-top:var(--space-4); padding:22px 26px 20px; border:1px solid var(--card-border); border-radius:var(--radius-thumb); background:radial-gradient(120% 150% at 0% 0%, rgba(244,198,107,.24), transparent 56%), radial-gradient(90% 130% at 100% 100%, rgba(190,110,30,.3), transparent 62%), rgba(255,255,255,.035); }
.titlecard .kind { margin:0; font-size:12px; font-weight:500; letter-spacing:.2em; text-transform:uppercase; color:var(--amber); }
.titlecard textarea { width:100%; margin-left:-7px; padding:4px 6px; resize:none; border:1px solid transparent; border-radius:10px; background:transparent; color:var(--white); font:inherit; font-size:clamp(24px, 2.3vw, 34px); font-weight:650; letter-spacing:-.01em; line-height:1.16; }
.titlecard textarea:hover:not(:disabled) { border-color:var(--rule); }
.titlecard textarea:focus { outline:none; border-color:var(--amber); }
.summary { color:var(--white-soft); font-size:15.5px; }
.points { flex:0 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
.point { flex-shrink:0; }
.ptext { overflow-wrap:anywhere; }
.edits { flex:0 1 auto; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:var(--space-2); margin:var(--space-4) 0; }
.edits:empty { display:none; }
.edits label { display:flex; flex-direction:column; gap:6px; padding:var(--space-3) var(--space-5); border:1px solid var(--amber); border-radius:var(--radius-row); background:var(--card); font-size:15px; font-weight:600; }
.edits textarea { resize:none; padding:0; border:0; background:transparent; color:var(--white); font:inherit; font-size:14.5px; font-weight:400; line-height:1.4; }
.edits textarea:focus { outline:none; }
.foot .again { margin-right:auto; color:var(--white-soft); }
.foot .later { color:var(--white); text-decoration:underline; text-underline-offset:4px; }
.foot:has(.later) { gap:var(--space-5); }
.foot:has(.later) .text-btn { white-space:nowrap; padding:0 4px; }
.foot .confirm { flex:none; }
.carried { flex:0 0 auto; display:flex; flex-direction:column; gap:6px; margin:0 0 var(--space-3); }
.carried-row { display:flex; gap:12px; margin:0; font-size:14.5px; line-height:1.4; }
.carried-row .k { flex:none; min-width:9.5em; font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--amber); padding-top:2px; }
.carried-row .v { color:var(--white-soft); overflow-wrap:anywhere; }
button.gold:disabled { opacity:.45; box-shadow:none; }
.text-btn:disabled, .quiet:disabled { opacity:.45; }
`;

const KEYFRAMES = '@keyframes coach-dot { 0%, 80%, 100% { opacity:.25; transform:translateY(0); } 40% { opacity:1; transform:translateY(-3px); } }';

export function installOwnIdeaStyle(doc = document) {
  if (doc.querySelector('[data-own-idea-style]')) return;
  const style = doc.createElement('style');
  style.dataset.ownIdeaStyle = 'true';
  style.textContent = `${KEYFRAMES}\nhtml[data-own-idea="true"] {${RULES}}`;
  doc.head.append(style);
}
