// Runtime layout for authored content; approved shell files stay unchanged.
export function installOwnIdeaStyle(doc = document) {
  if (doc.querySelector('[data-own-idea-style]')) return;
  const style = doc.createElement('style');
  style.dataset.ownIdeaStyle = 'true';
  style.textContent = "/* Runtime own-word content can grow; reference shells keep their frozen layout. */\nhtml[data-own-idea=\"true\"] .thread { overflow-y:auto; overscroll-behavior:contain; padding-right:8px; }\nhtml[data-own-idea=\"true\"] .thread > * { flex-shrink:0; }\nhtml[data-own-idea=\"true\"] .talk > .box,\nhtml[data-own-idea=\"true\"] .talk > button { flex-shrink:0; }\nhtml[data-own-idea=\"true\"] .cols { display:flex; flex-direction:column; overflow:hidden; gap:14px; }\nhtml[data-own-idea=\"true\"] .story { flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:0 12px 10px; }\nhtml[data-own-idea=\"true\"] .thumbs { flex:0 0 auto; border-left:0; border-top:1px solid var(--rule); padding:10px 12px 0; overflow:visible; }\nhtml[data-own-idea=\"true\"] .thumbs .eyebrow { display:none; }\nhtml[data-own-idea=\"true\"] .thumbs .cap { margin:0; color:var(--white-dim); font-size:12px; line-height:1.4; }\nhtml[data-own-idea=\"true\"] .idea > :not(.cols) { flex-shrink:0; }\nhtml[data-own-idea=\"true\"] .story .lbl { overflow-wrap:anywhere; }\nhtml[data-own-idea=\"true\"] .story .beat { overflow-wrap:anywhere; }\n";
  style.textContent += 'html[data-own-idea="true"] .idea:has([data-testid="keep-exploring"]) { overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }\n';
  style.textContent += `
@media (max-width: 800px) {
 html[data-own-idea="true"], html[data-own-idea="true"] body { height:auto; overflow-x:hidden; overflow-y:auto; }
 html[data-own-idea="true"] .app { display:block; height:auto; min-height:100dvh; }
 html[data-own-idea="true"] .nav { flex-direction:row; align-items:center; gap:4px; padding:10px 12px; border-right:0; border-bottom:1px solid var(--rule); }
 html[data-own-idea="true"] .brand { padding:0; margin:0 auto 0 0; font-size:24px; }
 html[data-own-idea="true"] .nav-item { height:40px; margin:0; padding:0 10px; gap:6px; font-size:13px; }
 html[data-own-idea="true"] .nav-item svg { width:18px; height:18px; }
 html[data-own-idea="true"] .nav-item[aria-disabled="true"] { display:none; }
 html[data-own-idea="true"] .stage { grid-template-columns:minmax(0,1fr); padding:12px; gap:12px; }
 html[data-own-idea="true"] .panel { padding:20px; }
 html[data-own-idea="true"] .talk { height:min(740px,calc(100dvh - 90px)); min-height:560px; }
 html[data-own-idea="true"] .title { font-size:30px; margin-top:16px; }
 html[data-own-idea="true"] .thread { margin-top:20px; }
 html[data-own-idea="true"] .head { flex-wrap:wrap; gap:10px; padding:0 0 14px; }
 html[data-own-idea="true"] .kind { flex-basis:100%; margin:0; }
 html[data-own-idea="true"] .cols { flex:none; overflow:visible; }
 html[data-own-idea="true"] .story { flex:none; overflow:visible; padding:0; }
 html[data-own-idea="true"] .thought { overflow-wrap:anywhere; }
}
`;
  doc.head.append(style);
}
