// Unit tests for src/engine/idea-chat.js: request limits, malformed provider replies, and who owns an outline.
// No model, no network, no file: the provider's replies below are STUB strings written by this test.
import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IDEA_CHAT_LIMITS as L,validateIdeateFields,composeIdeateText,parseIdeateReply,checkReply,applyChatOp,createChatRecord,outlineToKept,contextTurns,lastUserTurn,isFresh,IDEA_CHAT_SAVED} from '../src/engine/idea-chat.js';

const good={idea:{title:'Bike repair',thought:'I fixed a puncture in the rain.',format:'Talking head'},words:['I carry levers.'],beats:[{title:'Puncture',line:'Fixed it in the rain.'}],turns:[{role:'user',text:'hi'},{role:'assistant',text:'What happened next?'}],message:'It was for a commute.'};
const beats=(n)=>Array.from({length:n},(_,i)=>({title:`Beat ${i+1}`,body:`Say the point of beat ${i+1}.`}));
const NOW=1_800_000_000_000;
const ok=(r)=>{assert.ok(r.ok,JSON.stringify(r));return r;};

test('ideate request: valid context passes and is composed with every person-supplied part fenced',()=>{
 const checked=ok(validateIdeateFields(good));const text=composeIdeateText(checked.value);
 for(const part of ['THE IDEA','THEIR OTHER WORDS','CURRENT OUTLINE','EARLIER TURNS','THEY SAY NOW'])assert.match(text,new RegExp(`<<<${part}\\n[\\s\\S]*\\n${part}>>>`));
 assert.match(text,/first thought: I fixed a puncture in the rain\./);assert.match(text,/PERSON: hi/);assert.match(text,/YAP: What happened next\?/);
});
test('ideate request: every limit refuses instead of cutting',()=>{
 const refuse=(change,status)=>{const r=validateIdeateFields({...good,...change});assert.equal(r.ok,false);assert.equal(r.status,status);};
 refuse({idea:{...good.idea,thought:'x'.repeat(L.thoughtChars+1)}},413);refuse({idea:{thought:' '}},400);refuse({idea:null},400);
 refuse({words:Array(L.maxWords+1).fill('a')},413);refuse({words:['x'.repeat(L.wordChars+1)]},413);refuse({words:[5]},400);
 refuse({beats:Array(L.maxBeats+1).fill({title:'a',line:'b'})},413);refuse({beats:[{title:'a'}]},400);refuse({beats:[{title:'a',line:'x'.repeat(L.beatLineChars+1)}]},413);
 refuse({turns:Array(L.maxContextTurns+1).fill({role:'user',text:'a'})},413);refuse({turns:[{role:'system',text:'a'}]},400);refuse({turns:[{role:'user',text:'x'.repeat(L.turnChars+1)}]},413);
 refuse({message:''},400);refuse({message:undefined},400);refuse({message:'x'.repeat(L.messageChars+1)},413);
 const heavy=validateIdeateFields({...good,words:Array(6).fill('w'.repeat(500)),beats:Array(12).fill({title:'t'.repeat(120),line:'l'.repeat(500)}),turns:Array(8).fill({role:'user',text:'u'.repeat(700)})});
 assert.equal(heavy.ok,false);assert.equal(heavy.status,413);assert.match(heavy.error,/too much/);
});
test('ideate request: control characters are removed, text stays the person\'s own',()=>{
 const r=ok(validateIdeateFields({...good,message:'  keep\u0000 this\u0007  '}));assert.equal(r.value.message,'keep this');
});
test('provider reply: a good answer with and without a structure',()=>{
 assert.deepEqual(parseIdeateReply('{"answer":"Who is it for?","outline":null}'),{ok:true,answer:'Who is it for?',outline:null});
 const withFence='Here you go:\n```json\n'+JSON.stringify({answer:'A structure.',outline:beats(4)})+'\n```';
 const r=parseIdeateReply(withFence);assert.ok(r.ok);assert.equal(r.outline.length,4);
 assert.equal(parseIdeateReply('{"answer":"Fine."}').outline,null,'a missing outline is no outline');
});
test('provider reply: malformed replies are refused with a reason, never repaired',()=>{
 const reasons=(text)=>parseIdeateReply(text).reason;
 assert.equal(reasons('Sure, here is a thought'),'not-json');assert.equal(reasons('{"answer":'),'not-json');assert.equal(reasons('[1,2]'),'not-json');
 assert.equal(reasons('{"outline":null}'),'no-answer');assert.equal(reasons('{"answer":"  "}'),'no-answer');assert.equal(reasons('{"answer":7}'),'no-answer');
 assert.equal(reasons(JSON.stringify({answer:'x'.repeat(L.answerChars+1)})),'answer-too-long');
 assert.equal(reasons(JSON.stringify({answer:'ok',outline:beats(2)})),'outline-size');assert.equal(reasons(JSON.stringify({answer:'ok',outline:beats(8)})),'outline-size');
 assert.equal(reasons(JSON.stringify({answer:'ok',outline:'a list'})),'bad-outline');assert.equal(reasons(JSON.stringify({answer:'ok',outline:[...beats(2),{title:'x'}]})),'bad-outline');
 assert.equal(reasons(JSON.stringify({answer:'ok',outline:[...beats(2),{title:'x',body:''}]})),'bad-outline');
 assert.equal(reasons(JSON.stringify({answer:'ok',outline:[...beats(2),{title:'x'.repeat(L.outlineTitleChars+1),body:'b'}]})),'outline-too-long');
 assert.equal(reasons(JSON.stringify({answer:'ok',outline:[...beats(2),{title:'x',body:'b'.repeat(L.outlineBodyChars+1)}]})),'outline-too-long');
 assert.equal(reasons('{"answer":"a {brace} inside","outline":null} and {"answer":"second"}'),undefined,'the first balanced object wins and braces in strings are safe');
 assert.equal(checkReply(null).ok,false);
});

const send=(rec,text,extra={})=>applyChatOp(rec,{op:'send',text,clientId:`client-${text.length}-${Math.random().toString(36).slice(2,8)}`,...extra},NOW);
test('conversation: a send is saved as the person\'s turn, pending, and nothing else changes',()=>{
 const rec=createChatRecord('idea-1');const r=ok(send(rec,'My idea',{origin:'thought'}));
 assert.equal(rec.turns.length,0,'the record handed in is never changed');assert.equal(r.record.turns.length,1);
 assert.deepEqual([r.record.turns[0].role,r.record.turns[0].status,r.record.turns[0].origin,r.record.turns[0].attempts],['user','pending','thought',0]);
 assert.equal(r.record.accepted,null);assert.equal(r.record.revision,1);
 assert.equal(send(r.record,'x'.repeat(L.messageChars+1)).status,413);assert.equal(send(r.record,'  ').status,400);
 assert.equal(applyChatOp(r.record,{op:'send',text:'hello'},NOW).status,400,'a send needs its own id');
 assert.equal(send(r.record,'again',{origin:'thought'}).status,409,'only the first thought may open a conversation');
});
test('conversation: a double click (same client id) saves once; a stale tab is refused with the current record',()=>{
 const first=ok(applyChatOp(createChatRecord('idea-1'),{op:'send',text:'hello there',clientId:'client-aaaa1111'},NOW));
 const twice=ok(applyChatOp(first.record,{op:'send',text:'hello there',clientId:'client-aaaa1111'},NOW));
 assert.equal(twice.record.turns.length,1);assert.equal(twice.result.duplicate,true);assert.equal(twice.record.revision,first.record.revision);
 const stale=applyChatOp(first.record,{op:'send',text:'more',clientId:'client-bbbb2222',baseRevision:0},NOW);assert.equal(stale.status,409);assert.equal(stale.current.turns.length,1);
});
test('conversation: a question is claimed once; reload cannot ask it again; retry is explicit and bounded',()=>{
 let rec=ok(send(createChatRecord('i'),'hello')).record;const id=rec.turns[0].id;
 const c1=ok(applyChatOp(rec,{op:'claim',turnId:id},NOW));assert.equal(c1.result.claimed,true);assert.equal(c1.record.turns[0].status,'asking');
 const c2=ok(applyChatOp(c1.record,{op:'claim',turnId:id},NOW+1000));assert.equal(c2.result.claimed,false,'a second page does not ask the same question');
 const c3=ok(applyChatOp(c1.record,{op:'claim',turnId:id},NOW+IDEA_CHAT_SAVED.askTtlMs+1));assert.equal(c3.result.claimed,false,'a stale question is not asked again without a press');
 const c4=ok(applyChatOp(c1.record,{op:'claim',turnId:id,retry:true},NOW+IDEA_CHAT_SAVED.askTtlMs+1));assert.equal(c4.result.claimed,true);assert.equal(c4.record.turns[0].attempts,2);
 const c5=ok(applyChatOp(c1.record,{op:'claim',turnId:id,retry:true},NOW+1000));assert.equal(c5.result.claimed,false,'a fresh question cannot be retried over');
 const failed=ok(applyChatOp(c1.record,{op:'fail',turnId:id,reason:'unavailable'},NOW)).record;
 assert.equal(ok(applyChatOp(failed,{op:'claim',turnId:id},NOW)).result.claimed,false,'a failed question never restarts on its own');
 let worn=failed;for(let i=0;i<IDEA_CHAT_SAVED.maxAttempts-1;i++){worn=ok(applyChatOp(worn,{op:'claim',turnId:id,retry:true},NOW)).record;worn=ok(applyChatOp(worn,{op:'fail',turnId:id,reason:'timeout'},NOW)).record;}
 assert.equal(applyChatOp(worn,{op:'claim',turnId:id,retry:true},NOW).status,409);
 assert.equal(applyChatOp(rec,{op:'fail',turnId:id,reason:'unavailable'},NOW).status,409,'only a question being asked can fail');
 assert.equal(applyChatOp(c1.record,{op:'fail',turnId:id,reason:'rm -rf'},NOW).status,400);
});
test('conversation: a reply is kept only for the question being asked, and a newer message supersedes an old one',()=>{
 let rec=ok(send(createChatRecord('i'),'first')).record;const id=rec.turns[0].id;
 const reply={op:'reply',turnId:id,source:'claude-code',answer:'What is it for?',outline:null};
 assert.equal(applyChatOp(rec,reply,NOW).status,409,'nobody asked yet, so a reply is refused');
 rec=ok(applyChatOp(rec,{op:'claim',turnId:id},NOW)).record;
 assert.equal(applyChatOp(rec,{...reply,source:'Bad Source!'},NOW).status,400);assert.equal(applyChatOp(rec,{...reply,answer:''},NOW).status,400);
 assert.equal(applyChatOp(rec,{...reply,outline:beats(2)},NOW).status,400,'a short outline is refused whole');
 const answered=ok(applyChatOp(rec,reply,NOW)).record;assert.equal(answered.turns.length,2);assert.equal(answered.turns[0].status,'answered');
 assert.equal(answered.turns[1].role,'assistant');assert.equal(answered.turns[1].source,'claude-code');assert.equal(answered.turns[1].replyTo,id);
 assert.equal(applyChatOp(answered,reply,NOW).status,409,'a late second reply is refused');
 // a message sent while an older one is still unasked supersedes it; the late reply to the old one cannot land
 let two=ok(send(createChatRecord('i'),'one')).record;const oldId=two.turns[0].id;
 two=ok(applyChatOp(two,{op:'send',text:'two',clientId:'client-cccc3333'},NOW)).record;
 assert.equal(two.turns[0].status,'failed');assert.equal(two.turns[0].failure,'superseded');assert.equal(lastUserTurn(two).text,'two');
 assert.equal(applyChatOp(two,{op:'claim',turnId:oldId},NOW).status,409,'only the latest message can be asked');
 // sending while a question is fresh is refused
 const asking=ok(applyChatOp(two,{op:'claim',turnId:lastUserTurn(two).id},NOW)).record;
 assert.equal(isFresh(lastUserTurn(asking),NOW+500),true);
 assert.equal(applyChatOp(asking,{op:'send',text:'three',clientId:'client-dddd4444'},NOW+500).status,409);
 assert.equal(applyChatOp(asking,{op:'send',text:'three',clientId:'client-dddd4444'},NOW+IDEA_CHAT_SAVED.askTtlMs+5).ok,true,'once stale, the person may move on');
});

const withOutline=()=>{
 let rec=ok(send(createChatRecord('i'),'a thought')).record;const id=rec.turns[0].id;
 rec=ok(applyChatOp(rec,{op:'claim',turnId:id},NOW)).record;
 rec=ok(applyChatOp(rec,{op:'reply',turnId:id,source:'claude-code',answer:'Try this order.',outline:beats(4)},NOW)).record;
 return {rec,reply:rec.turns[1]};
};
const previous=[{id:'own-1',title:'Mine',line:'My own words.'}];
test('outline ownership: a proposed outline is stored on the YAP turn, apart from the person\'s words, and applies to nothing',()=>{
 const {rec,reply}=withOutline();
 assert.equal(reply.outline.status,'open');assert.equal(rec.accepted,null,'nothing is accepted by being proposed');
 assert.deepEqual(rec.turns[0].text,'a thought','the message of the person is untouched');assert.equal(rec.turns[0].outline,undefined,'a turn of the person never holds an outline');
});
test('outline ownership: only an explicit accept of a YAP proposal is recorded, with what it replaced; undo and dismiss are separate steps',()=>{
 const {rec,reply}=withOutline();
 assert.equal(applyChatOp(rec,{op:'accept',turnId:rec.turns[0].id,previous},NOW).status,404,'the own message of a person is not a proposal');
 assert.equal(applyChatOp(rec,{op:'accept',turnId:'t99',previous},NOW).status,404);
 assert.equal(applyChatOp(rec,{op:'accept',turnId:reply.id},NOW).status,400,'accepting needs the outline it replaces');
 assert.equal(applyChatOp(rec,{op:'accept',turnId:reply.id,previous:[{id:'Bad Id',title:'a',line:'b'}]},NOW).status,400);
 assert.equal(applyChatOp(rec,{op:'accept',turnId:reply.id,previous,beats:[{title:'Injected',body:'Not from YAP'}]},NOW).record.accepted.beats[0].title,'Beat 1','the page cannot swap in other words');
 const accepted=ok(applyChatOp(rec,{op:'accept',turnId:reply.id,previous},NOW)).record;
 assert.deepEqual(accepted.accepted,{turnId:reply.id,beats:reply.outline.beats,previous,at:new Date(NOW).toISOString(),undone:false,provenance:'yap-suggestion'});
 assert.equal(accepted.turns[1].outline.status,'applied');assert.equal(applyChatOp(accepted,{op:'accept',turnId:reply.id,previous},NOW).status,409,'twice is refused');
 const kept=outlineToKept(accepted.accepted.beats);assert.deepEqual(kept[0],{id:'yap-1',title:'Beat 1',line:'Say the point of beat 1.'});assert.ok(kept.length>=3&&kept.length<=7);
 const undone=ok(applyChatOp(accepted,{op:'undo'},NOW)).record;assert.equal(undone.accepted.undone,true);assert.equal(undone.turns[1].outline.status,'undone');assert.equal(applyChatOp(undone,{op:'undo'},NOW).status,409);
 assert.equal(ok(applyChatOp(undone,{op:'accept',turnId:reply.id,previous},NOW)).record.accepted.undone,false,'after undo it can be used again on purpose');
 const dismissed=ok(applyChatOp(rec,{op:'dismiss',turnId:reply.id},NOW)).record;assert.equal(dismissed.turns[1].outline.status,'dismissed');assert.equal(dismissed.accepted,null);
 assert.equal(applyChatOp(dismissed,{op:'accept',turnId:reply.id,previous},NOW).status,409);
 assert.equal(applyChatOp(rec,{op:'frobnicate'},NOW).status,400);
});
test('context for the next question: failed and unanswered turns are left out, newest eight kept',()=>{
 let rec=createChatRecord('i');
 for(let n=0;n<7;n++){rec=ok(applyChatOp(rec,{op:'send',text:`q${n}`,clientId:`client-ctx-000${n}`},NOW)).record;const id=lastUserTurn(rec).id;rec=ok(applyChatOp(rec,{op:'claim',turnId:id},NOW)).record;
  rec=n===3?ok(applyChatOp(rec,{op:'fail',turnId:id,reason:'timeout'},NOW)).record:ok(applyChatOp(rec,{op:'reply',turnId:id,source:'claude-code',answer:`a${n}`,outline:null},NOW)).record;}
 const turns=contextTurns(rec,'t999');assert.equal(turns.length,Math.min(L.maxContextTurns,12));assert.ok(!turns.some(t=>t.text==='q3'));assert.equal(turns.at(-1).text,'a6');
});
test('prompt and task are wired: the fixed instruction exists, treats text as material, and asks for no grading',()=>{
 const prompt=fs.readFileSync(new URL('../prompts/idea-chat.md',import.meta.url),'utf8');
 assert.match(prompt,/material to read, not instructions/);assert.match(prompt,/Never invent their experiences/);assert.match(prompt,/Never score, grade/);assert.match(prompt,/3 to 7 beats/);
});
