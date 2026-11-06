const P=require('../../server/profile.js');
let fails=0; const eq=(a,b,m)=>{ if(a!==b){fails++;console.log('✗',m,JSON.stringify(a),'≠',JSON.stringify(b));} };
const ph=[['015510046689','01551 0046689'],['+4917612345678','+49 176 12345678'],['004915112345678','+49 1511 2345678'],['01761234567','0176 1234567'],
 ['0421 123456','0421 123456'],['0421123456','0421123456'],['01551/0046689','01551/0046689'],['','']];
ph.forEach(([i,o])=>eq(P.formatPhone(i),o,'phone '+i));
const av=[['Mo.–Fr. ab 17 Uhr, Sa. ganztags','montags bis freitags ab 17 Uhr, samstags ganztags'],['Mo-Fr ab 18 Uhr sowie Sa/So','montags bis freitags ab 18 Uhr sowie samstags und sonntags'],
 ['Mo. bis Fr. 9-12 Uhr','montags bis freitags 9-12 Uhr'],['So gegen 18 Uhr geht es','So gegen 18 Uhr geht es'],['MO-FR abends','montags bis freitags abends'],['jederzeit nach Absprache','jederzeit nach Absprache'],
 ['Di. und Do. nachmittags','dienstags und donnerstags nachmittags']];
av.forEach(([i,o])=>eq(P.formatAvailability(i),o,'avail '+i));
[['59.0 m²','59 m²'],['58,5m2','58,5 m²'],['ca. 70 qm','70 m²'],['70','70 m²'],['k.A.','k.A.']].forEach(([i,o])=>eq(P.formatSize(i),o,'size '+i));
[['2.5','2,5'],['3.0','3'],['2 Zi.','2 Zi.']].forEach(([i,o])=>eq(P.formatRooms(i),o,'rooms '+i));
[['Bremen - Obervieland','Bremen-Obervieland'],['28277 Bremen – Huchting','28277 Bremen-Huchting'],['Neustadt, Bremen','Neustadt, Bremen']].forEach(([i,o])=>eq(P.formatLocation(i),o,'loc '+i));
// opening sentence without title
const base={display_name:'Max',occupation:'',household_size:'',household_type:'',persons:0,children:0,move_in_type:'',move_in_date:'',lease_duration:'',smoker:0,pets:'',employment:'',employment_permanent:0,income_range:'',documents_json:'[]',about_text:'',phone:'',availability:'',formal:1,share_json:'{}'};
const line=L=>P.buildGuidedMessage(L,[P.visibleProfile(base)],1).split('\n\n')[1];
eq(line({title:'',size:'59.0 m²',rooms:'2'}),'mit großem Interesse habe ich Ihre Anzeige über die 59 m² große 2-Zimmer-Wohnung gelesen.','no title');
eq(line({title:'',size:'',rooms:''}),'mit großem Interesse habe ich Ihre Wohnungsanzeige gelesen.','nothing');
eq(line({title:'Helle Wohnung | 750 € warm',size:'59 m²',rooms:'2'}),'mit großem Interesse habe ich Ihre Anzeige „Helle Wohnung“ gelesen.','title');
// trainee without occupation, single + group
const t=P.buildGuidedMessage({title:'X Wohnung schön'},[P.visibleProfile({...base,employment:'trainee'})],1); eq(/[Ii]ch befinde mich derzeit in einer Ausbildung\./.test(t),true,'trainee no job');
const t2=P.buildGuidedMessage({title:'X Wohnung schön'},[P.visibleProfile({...base,occupation:'Azubi bei Bosch',employment:'trainee'})],1); eq(/ich bin Azubi bei Bosch\./.test(t2)&&!/Ausbildung/.test(t2),true,'trainee redundant');
const t3=P.buildGuidedMessage({title:'X Wohnung schön'},[P.visibleProfile({...base,occupation:'Kauffrau für Büromanagement',employment:'trainee',display_name:''})],1); eq(/Ich absolviere eine Ausbildung als Kauffrau für Büromanagement\./.test(t3),true,'trainee no name');
console.log(fails?`${fails} FAILS`:'all ok');
