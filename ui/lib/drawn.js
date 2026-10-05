const names=['Intro','Problem','Solution','Example','Close'];
export const DRAWN = Object.freeze({
 live:{rail:names.map((title,i)=>({title,state:i<2?'done':i===2?'current':'ahead',caption:i===1?'YAP ticked this: good take':''})),story:{title:'Why this matters',points:['The week my tips stopped working','What I changed','What happened next'],cue:'Smile'}},
 heyyap:{rail:names.map((title,i)=>({title,state:i===0?'current':'ahead'})),story:{title:'Intro',points:["Grab a tea. Let's get into it.",'Who this is for','What you will get'],cue:'Smile'},panel:{remark:"Let's try 'Grab a coffee' instead of 'Grab a tea.'",reply:'Try it for three videos, then check in?',proposal:{id:'drawn',category:'Greeting',to:"Grab a coffee. Let's get into it.",trialLength:3}}}
});
