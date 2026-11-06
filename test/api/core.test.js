const BASE = process.env.TEST_BASE;            // set by test/run.js
// Regression for everything that reads visibility/ratings (rewritten after the scratchpad loss).
const B=BASE;
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
const client=()=>{ let cookie=''; return async (method,path,body)=>{ const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined}); const sc=r.headers.get('set-cookie'); if(sc) cookie=sc.split(';')[0]; const t=await r.text(); try{return JSON.parse(t);}catch(_){return {_status:r.status};} }; };
(async()=>{
  const A=client(), Bn=client();
  await A('POST','/api/auth/login',{email:'anna@x.de',password:'secret123'});
  await Bn('POST','/api/auth/register',{username:'Ben',email:'ben@x.de',password:'secret123'});
  let q=(await A('GET','/api/listings/swipe')).listings; const L=q.map(l=>l.id).sort((a,b)=>a-b);
  ok(L.length===6,'Anna: 6 listings in the stack');
  ok((await Bn('GET','/api/listings/swipe')).listings.length===6,'Ben sees the global agent\'s listings too');
  const sw=(id,action,c=A)=>c('POST','/api/listings/swipe',{listingId:id,action});
  await sw(L[0],'like'); await sw(L[1],'dislike'); await sw(L[2],'superlike'); await sw(L[3],'skip');
  q=(await A('GET','/api/listings/swipe')).listings;
  ok(q.length===3&&q[q.length-1].id===L[3],'rated ones gone, skipped one at the end: '+q.map(l=>l.id));
  let rated=(await A('GET','/api/listings/rated')).listings;
  ok(rated.length===4&&rated.find(r=>r.id===L[2]).my_swipe==='superlike','"Bewertet": 4 entries (incl. skip) with my_swipe');
  ok((await A('POST','/api/listings/swipe/undo-last')).undoneAction==='skip','undo-last undoes the skip');
  await A('DELETE',`/api/listings/swipe/${L[0]}`);
  ok((await A('GET','/api/listings/swipe')).listings.some(l=>l.id===L[0]),'withdrawn rating → back in the stack');
  const del=await A('DELETE','/api/listings/rated',{listingIds:[L[1],L[2]]});
  ok(del.deleted===2,'bulk delete of 2 ratings');
  await sw(L[4],'like');
  await A('POST',`/api/listings/${L[4]}/report-offline`);
  ok((await A('GET','/api/archive')).listings.some(l=>l.id===L[4])&&!(await A('GET','/api/listings/rated')).listings.some(l=>l.id===L[4]),'reported offline → archive, not "Bewertet"');
  ok(!(await Bn('GET','/api/listings/swipe')).listings.some(l=>l.id===L[4]),'offline listing gone from Ben\'s stack');
  // hand-added: known URL gets Ben's own source
  const url=(await A('GET',`/api/listings/${L[5]}`)).listing.url;
  const add=await Bn('POST','/api/listings/add',{url,visibility:'private'});
  ok(add.success&&add.listing.id===L[5],'adding a known URL links it instead of duplicating');
  ok((await Bn('GET','/api/listings/mine')).listings.some(l=>l.id===L[5]),'… and it shows under Ben\'s "hinzugefügte Inserate"');
  ok((await Bn('PATCH',`/api/listings/${L[5]}/visibility`,{visibility:'global'})).success,'Ben may change the visibility of his own entry');
  const forbidden=await A('PATCH',`/api/listings/${L[5]}/visibility`,{visibility:'private'});
  ok(!!forbidden.error,'Anna (no hand-added entry) may not: '+forbidden.error);
  const job=(await A('GET','/api/jobs')).jobs.find(j=>j.label==='Seed');
  ok((await A('GET',`/api/jobs/${job.id}/listings`)).listings.length===6,'agent lists its 6 listings');
  // group: both like → one entry, unanimous
  const g=(await A('POST','/api/groups/create',{name:'WG'})).group;
  await Bn('POST','/api/groups/join',{code:g.invite_code});
  const benId=(await Bn('GET','/api/auth/me')).id; await A('POST',`/api/groups/${g.id}/requests/${benId}/accept`);
  await sw(L[5],'like'); await sw(L[5],'superlike',Bn);
  const res=(await A('GET',`/api/groups/${g.id}/results`)).results;
  const e=res.find(r=>r.id===L[5]);
  ok(e&&e.votes.length===2&&e.tier==='einstimmig'&&e.my_swipe==='like','group results: 2 votes, einstimmig, my_swipe');
  ok(res.every(r=>r.id!==L[4]),'offline listing not in group results');
  // message generation still fine
  const m=await A('POST','/api/message/generate',{listingId:L[5],mode:'guided'});
  ok(/gelesen/.test(m.message||''),'message generator works');
  console.log(fails?`${fails} FAILS`:'all ok');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
