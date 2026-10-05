export const IDEA_STATES=Object.freeze(['exploring','shaping','confirming','saved','thought']);
export function screenForState(state){return state==='shaping'?'concept':state==='confirming'?'confirm':'conversation';}
export function nextState(state,action){if(action==='confirm')return 'saved';if(action==='save-thought')return 'thought';if(action==='save')return 'confirming';if(action==='keep-exploring')return 'shaping';return state;}

/** Exact user-authored material, never inferred conversation history. */
export function ideaWords(idea = {}) {
 const first=idea.thought || idea.title || '', rest=Array.isArray(idea.words)?idea.words.slice():[];
 if(rest[0]?.trim()===first.trim())rest.shift();
 return [first, ...rest]
  .filter(word => typeof word === 'string' && word.trim()).map(word => word.trim());
}
/** An editable outline made only by splitting the person's words: what an idea with no accepted outline shows as its beats. */
export function outlineFromWords(idea = {}) {
 const parts=ideaWords(idea).flatMap(text=>text.split(/\n+|(?<=[.!?])\s+|;\s*|,\s+(?=and\b|then\b|but\b)/i))
  .map(text=>text.trim()).filter(Boolean).slice(0,12);
 return parts.map((line,i)=>({id:`own-${i+1}`,title:line.split(/\s+/).slice(0,7).join(' '),line,source:'idea',state:'yours'}));
}
export function ideaView(idea = {}) {
 const messages=ideaWords(idea), rows=idea.keptBeats?.length||idea.ticks?.['outline-edited']?idea.keptBeats:outlineFromWords(idea);
 return {messages,rows,title:idea.title || messages[0] || 'Your idea',format:idea.format || 'Talking head',
  summary:messages.join('\n')};
}
