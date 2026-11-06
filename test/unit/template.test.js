const P=require('../../server/profile.js');
const base={display_name:'',occupation:'',household_size:'',household_type:'',persons:0,children:0,move_in_type:'',move_in_date:'',lease_duration:'',smoker:0,pets:'',employment:'',employment_permanent:0,income_range:'',documents_json:'[]',about_text:'',phone:'',availability:'',formal:1,share_json:'{}'};
const docs=JSON.stringify([{doc:'Mietschuldenfreiheitsbescheinigung',status:'vorhanden'},{doc:'Mieterselbstauskunft',status:'vorhanden'}]);
const L={title:'2-Zimmer-Wohnung in Bremen-Walle',location:'Walle - Steffensweg',tags_json:'["Einbauküche","Keller"]'};
const me=P.visibleProfile({...base,display_name:'Philipp Moser',household_type:'couple',persons:2,documents_json:docs});
const TPL=`Sehr geehrte Damen und Herren,

mit großem Interesse habe ich Ihre Anzeige "{titel}" gelesen. Meine Partnerin, Katharina Maier, und
ich suchen gemeinsam eine Wohnung in Bremen und möchten uns Ihnen hiermit gerne
vorstellen.

Wir sind beide 20 Jahre alt, zuverlässig, ruhig und Nichtraucher. Meine Partnerin
absolviert derzeit ein duales Studium bei der Agentur für Arbeit. Ich befinde mich
in einer Ausbildung in der IT-Branche und wohne derzeit in einer WG in Bremen.
Unsere Miete können wir aus eigenen Einkünften zuverlässig tragen.

{grund}

Auf Wunsch stellen wir Ihnen gerne vorab unsere Unterlagen zur Verfügung,
{unterlagen}. Unsere Eltern
würden sich zusätzlich auch als Bürgen zur Verfügung stellen.

Über eine Einladung zu einem Besichtigungstermin würden wir uns sehr freuen.

Mit freundlichen Grüßen

Philipp Moser 
Katharina Maier`;
const out=P.applyTemplate(TPL,P.buildPlaceholders(L,me,[me],null,{formal:true})).text;
console.log(out);
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
console.log('\n---');
ok(!/[a-zäöüß,]\n[a-zäöüß]/i.test(out.split('Mit freundlichen')[0].replace(/\n\n/g,'¶')),'no line break inside a sentence');
ok(/zur Verfügung: die Mietschuldenfreiheitsbescheinigung und die Mieterselbstauskunft\. Unsere Eltern würden/.test(out),'documents as list after the comma, no ".."');
ok(/Mit freundlichen Grüßen\n\nPhilipp Moser\s*\nKatharina Maier$/.test(out),'signature lines kept');
ok(/^Sehr geehrte Damen und Herren,\n\nmit großem/.test(out),'greeting kept');
// mixed statuses → sentence form, still no double full stop
const me2=P.visibleProfile({...me,documents_json:JSON.stringify([{doc:'SCHUFA-Auskunft',status:'vorhanden'},{doc:'Gehaltsnachweise',status:'beantragt'}])});
const out2=P.applyTemplate('Unterlagen gibt es auch,\n{unterlagen}. Danke.',P.buildPlaceholders(L,me2,[me2],null,{formal:true})).text;
console.log('   mixed:',out2); ok(/auch\. Die SCHUFA-Auskunft stellen wir Ihnen gerne zur Verfügung\. Die Gehaltsnachweise sind bereits beantragt\. Danke\./.test(out2),'mixed statuses → sentences, no ".."');
// things that must stay as they are
const keep=`Hallo,\n\nkurz und knapp:\n- Einzug: sofort\n- Haustiere: keine\n\nViele Grüße\nAnna`;
ok(P.unwrapHardBreaks(keep)===keep,'lists, short lines, greeting and sign-off untouched');
const longThenClose='Über eine Rückmeldung und die Möglichkeit einer Besichtigung würden wir uns sehr freuen.\nMit freundlichen Grüßen\nAnna';
ok(P.unwrapHardBreaks(longThenClose)===longThenClose,'long last line before "Mit freundlichen Grüßen" stays separate');
ok(P.applyTemplate('Bis bald... {name}',{name:'Anna'}).text==='Bis bald... Anna','ellipsis untouched');
console.log(fails?`${fails} FAILS`:'all ok');
