const P=require('../../server/profile.js');
const base={display_name:'',occupation:'',household_size:'',household_type:'',persons:0,children:0,move_in_type:'',move_in_date:'',lease_duration:'',smoker:0,pets:'',employment:'',employment_permanent:0,income_range:'',documents_json:'[]',about_text:'',phone:'',availability:'',formal:1,share_json:'{}'};
const L={title:'Helle Wohnung am Park'};
const intro=(profiles,members,formal=1)=>P.buildGuidedMessage(L,profiles.map(p=>P.visibleProfile(p)),formal,members&&members.map(p=>P.visibleProfile(p))).split('\n\n')[2];
let fails=0; const eq=(a,b,m)=>{ if(a!==b){fails++;console.log('✗',m,'\n   got ',a,'\n   want',b);} else console.log('✓',m,'→',a); };
eq(intro([{...base,household_type:'family',persons:4,children:2,display_name:'Anna Schmidt',employment:'employed',employment_permanent:1}]),
   'Wir bewerben uns als Familie mit vier Personen, davon zwei Kinder. Anna Schmidt ist unbefristet angestellt.','family, one profile, kids, no job');
const G3=P.groupAsProfile({...base,household_type:'wg'},3);
eq(intro([G3],[{...base,display_name:'Tom',occupation:'Student der Informatik',employment:'student',_username:'tom'},{...base,display_name:'Mia',occupation:'Grafikdesignerin',employment:'self_employed',_username:'mia'},{...base,display_name:'Jan',employment:'trainee',_username:'jan'}]),
   'Wir, Tom, Mia und Jan, bewerben uns als WG zu dritt. Tom ist Student der Informatik, Mia ist als Grafikdesignerin selbstständig und Jan befindet sich derzeit in einer Ausbildung.','WG of three, mixed');
const G2=P.groupAsProfile({...base,household_type:'couple'},2);
eq(intro([G2],[{...base,display_name:'Tom',employment:'employed',employment_permanent:1,_username:'t'},{...base,display_name:'Mia',employment:'employed',employment_permanent:1,_username:'m'}]),
   'Wir, Tom und Mia, bewerben uns als Paar. Wir sind beide unbefristet angestellt.','same status → "Wir sind beide"');
eq(intro([{...base,household_type:'couple',persons:2,employment:'employed'}]),
   'Wir bewerben uns als Paar. Eine Person aus unserem Haushalt ist angestellt.','no name at all');
eq(intro([{...base,household_type:'couple',persons:2,display_name:'Anna',occupation:'Ärztin',employment:'employed',share_json:JSON.stringify({intro:false})}]),
   'Wir bewerben uns als Paar. Anna ist angestellt.','intro hidden: job gone, name stays (it is in the signature anyway)');
eq(intro([{...base,household_type:'couple',persons:2,display_name:'Anna',occupation:'Ärztin',employment:'employed',share_json:JSON.stringify({employment:false})}],null,0),
   'Wir bewerben uns als Paar. Anna ist Ärztin.','employment hidden, informal');
eq(intro([{...base,display_name:'Max Muster',occupation:'Duale Studentin bei der Agentur für Arbeit',employment:'student'}]),
   'Mein Name ist Max Muster und ich bin Duale Studentin bei der Agentur für Arbeit.','solo, occupation already says "student"');
eq(intro([{...base,display_name:'Max',occupation:'Kaufmännische Angestellte',employment:'employed',employment_permanent:1}]),
   'Mein Name ist Max und ich bin Kaufmännische Angestellte in unbefristeter Anstellung.','occupation contains "Angestellte" + permanent');
eq(intro([{...base,occupation:'Lehrer',employment:'retired'}]),'Ich bin Lehrer im Ruhestand.','no name, retired');
console.log(fails?`${fails} FAILS`:'all ok');
