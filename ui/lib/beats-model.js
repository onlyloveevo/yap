import { preparedAngleFields } from '../../src/engine/prepared-angles.js';
// The beat list's two rules, as pure functions (D-117, D-118, D-120): which
// rows an idea's beat list shows, and which of them the person kept.
//
// A row is { id, title, line, source, state }:
//   source  'idea' (the tag "From your idea") or 'suggestion' ("YAP suggestion")
//   state   'yours' for a beat from the idea, 'suggested' for a suggestion, and
//           'accepted' once the person has pressed Accept on it. The shell's own
//           script sets 'accepted'; nothing here does, so nothing accepts itself.
//
// No page, no server and no model: ui/beats/wire.js does the asking.
import { defaultBeats } from '../../src/engine/setup-beats.js';

/** A row's state by its source, as the shell draws it. */
const STATE_OF = Object.freeze({ idea: 'yours', suggestion: 'suggested' });

const text = (value) => (typeof value === 'string' ? value : '');

/**
 * Is this row one the person kept? A beat from their idea is theirs already; a
 * suggestion is theirs only once they pressed Accept (D-118). The state is what
 * counts; a row with no state is read by its source.
 * @param {any} row
 */
function isKept(row) {
  if (row.state === 'yours' || row.state === 'accepted') return true;
  return row.state === undefined && row.source === 'idea';
}

/**
 * The beats the person kept, in the order the rows are in (D-120): every beat
 * from their idea and every accepted suggestion. A suggestion that was not
 * accepted is left out. Each kept beat is its id, its title and its line, and
 * nothing else: that is what the idea store keeps.
 * @param {{ id: string, title: string, line: string, state?: string, source?: string }[]} rows
 *   the rows top to bottom, as `yap:beats-ready` carries them or as beatRows gives them
 * @returns {{ id: string, title: string, line: string }[]}
 */
export function keptBeats(rows) {
  if (!Array.isArray(rows)) return [];
  const kept = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) continue;
    if (isKept(row)) kept.push({ id: row.id, title: text(row.title), line: text(row.line), ...preparedAngleFields(row.preparedAngles) });
  }
  return kept;
}

/**
 * The rows of an idea's beat list (D-117).
 *
 * An idea that brings its own beats (the bundled sample idea and its five
 * drawn ones) gives those, with no model: a beat from the idea is 'yours', a
 * suggestion is 'suggested'. Any other idea gives SETUP-01's beats, each one a
 * suggestion: the ones `writeBeats` wrote when they are handed in, and the
 * engine's default beats otherwise. A story beat's label is the row's title,
 * and its triggers, joined, are the row's line.
 *
 * No row is ever given as accepted.
 * @param {{ beats?: { id: string, title: string, line: string, source: string }[] } | null} [idea]
 * @param {{ id: string, label: string, points?: string[] }[] | null} [storyBeats] what writeBeats gave for this idea
 * @returns {{ id: string, title: string, line: string, source: 'idea' | 'suggestion', state: 'yours' | 'suggested' }[]}
 */
export function beatRows(idea, storyBeats) {
  const own = idea && Array.isArray(idea.beats) ? idea.beats : [];
  if (own.length > 0) {
    return own.map((beat) => {
      const source = beat.source === 'idea' ? 'idea' : 'suggestion';
      return { id: beat.id, title: text(beat.title), line: text(beat.line), ...preparedAngleFields(beat.preparedAngles), source, state: STATE_OF[source] };
    });
  }
  const written = Array.isArray(storyBeats) && storyBeats.length > 0 ? storyBeats : defaultBeats();
  return written.map((beat) => ({
    id: beat.id,
    title: text(beat.label),
    line: (Array.isArray(beat.points) ? beat.points : []).filter((point) => typeof point === 'string').join(', '),
    source: 'suggestion',
    state: STATE_OF.suggestion,
  }));
}

import { outlineFromWords } from './idea-model.js';
import { isSuggestionId } from '../../src/engine/formats.js';
/**
 * Runtime only: the rows of a person's beat list. Their own beats come first:
 * the saved ones when the list was ever edited, else the idea's bundled ones,
 * else their words split into beats. YAP's suggestions follow: the idea's
 * bundled ones, or the ones YAP wrote for this idea and the idea still carries
 * (offeredBeats, src/engine/beat-list.js). A suggestion the person accepted is
 * among the saved beats and shows as accepted. A bundled one they removed (a
 * tick named skip-<id>) is not offered again.
 */
export function editableRows(idea = {}) {
 const edited=Boolean(idea.keptBeats?.length||idea.ticks?.['outline-edited']);
 const bundled=idea.beats?.length?beatRows(idea):[];
 const base=edited?(idea.keptBeats||[]):bundled.length?bundled.filter(row=>row.source==='idea'):outlineFromWords(idea);
 const written=(Array.isArray(idea.offeredBeats)?idea.offeredBeats:[]).map(beat=>({id:beat.id,title:text(beat.title),line:text(beat.line),source:'suggestion',state:'suggested'}));
 const offered=bundled.length?bundled.filter(row=>row.source==='suggestion'):written;
 const offeredIds=new Set(offered.map(row=>row.id));
 const own=base.map(beat=>offeredIds.has(beat.id)||isSuggestionId(beat.id)||/^suggestion-\d+$/.test(beat.id)?{...beat,source:'suggestion',state:'accepted'}:{...beat,source:'idea',state:'yours'});
 const keptIds=new Set(own.map(row=>row.id));
 return [...own,...offered.filter(row=>!keptIds.has(row.id)&&idea.ticks?.[`skip-${row.id}`]!==true)].slice(0,12);
}
/** The suggestions still waiting on a list, as the idea keeps them. */
export function offeredBeats(rows) {
 return (Array.isArray(rows)?rows:[]).filter(row=>row&&row.state==='suggested'&&typeof row.id==='string').map(row=>({id:row.id,title:text(row.title),line:text(row.line)}));
}
export function refinedRows(rows,id,text) {
 const line=String(text || '').trim();if(!line)return rows;
 if(id && rows.some(row=>row.id===id))return rows.map(row=>row.id===id?{...row,line,source:'idea',state:'yours'}:row);
 if(rows.length>=12)return rows;
 const used=new Set(rows.map(row=>row.id));let n=1;while(used.has(`own-${n}`))n++;
 // A new beat is the person's: it goes after their last kept beat, ahead of the suggestions still waiting at the end.
 let at=rows.length;while(at>0&&rows[at-1].state==='suggested')at--;
 return [...rows.slice(0,at),{id:`own-${n}`,title:line.split(/\s+/).slice(0,7).join(' '),line,source:'idea',state:'yours'},...rows.slice(at)];
}
