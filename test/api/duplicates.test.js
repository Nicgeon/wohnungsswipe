const BASE = process.env.TEST_BASE;            // set by test/run.js
const B=BASE;
let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
const client=()=>{ let cookie=''; return async (method,path,body)=>{ const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json',cookie},body:body?JSON.stringify(body):undefined}); const sc=r.headers.get('set-cookie'); if(sc) cookie=sc.split(';')[0]; return r.json().catch(()=>({})); }; };
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const A=client(), Bn=client();
  await A('POST','/api/auth/register',{username:'Anna',email:'anna@x.de',password:'secret123'});
  await Bn('POST','/api/auth/register',{username:'Ben',email:'ben@x.de',password:'secret123'});
  const g=(await A('POST','/api/groups/create',{name:'WG'})).group;
  await Bn('POST','/api/groups/join',{code:g.invite_code});
  const benId=(await Bn('GET','/api/auth/me')).id;
  await A('POST',`/api/groups/${g.id}/requests/${benId}/accept`);
  const j1=(await A('POST','/api/jobs',{label:'Anna privat',search_url:'https://www.kleinanzeigen.de/s-wohnung-mieten/bremen/c203',visibility:'private'})).job;
  const j2=(await Bn('POST','/api/jobs',{label:'WG-Gruppe',search_url:'https://www.kleinanzeigen.de/s-wohnung-mieten/bremen/k0c203',visibility:'group',visibility_id:g.id})).job;
  const q=async c=>(await c('GET','/api/listings/swipe')).listings||[];
  const titles=ls=>ls.map(l=>l.title).sort().join(',');

  console.log('── A: Quellen statt Besitzer');
  await A('POST',`/api/jobs/${j1.id}/run`); await wait(600);
  ok(titles(await q(A))==='U1 Altbau','Anna (private agent) sees U1');
  ok(titles(await q(Bn))==='','Ben does not see Anna\'s private find');
  await Bn('POST',`/api/jobs/${j2.id}/run`); await wait(800);
  const bq=await q(Bn);
  ok(bq.some(l=>l.title==='U1 Altbau'),'after the group agent ran, Ben sees U1 too (was silently skipped before)');
  const jobs=(await Bn('GET','/api/jobs')).jobs; const jj=jobs.find(j=>j.id===j2.id);
  ok(jj.last_new===1,`group agent counts 1 new flat (U2 and its Immowelt copy are one flat, U1 was known): last_new=${jj.last_new}`);
  const gl=(await Bn('GET',`/api/jobs/${j2.id}/listings`)).listings||[];
  ok(gl.length===3,`group agent lists all 3 of its listings incl. linked U1 (${gl.length})`);

  console.log('── B: dieselbe Wohnung auf zwei Portalen');
  const flat=bq.find(l=>/U2|U3/.test(l.title));
  ok(bq.filter(l=>/U2|U3/.test(l.title)).length===1,'U2 (LEG) and U3 (Immowelt) appear as ONE card');
  ok(flat.also_on?.length===1&&/immowelt|leg/.test(flat.also_on[0].platform),'card lists the other portal in also_on: '+JSON.stringify(flat.also_on?.map(a=>a.platform)));
  const me=await Bn('GET','/api/auth/me');
  const all=(await A('GET','/api/listings/swipe')).listings; const u2=all.find(l=>/U2|U3/.test(l.title));
  const otherId=u2.also_on[0].id;
  await Bn('POST','/api/listings/swipe',{listingId:flat.id,action:'like'});
  ok(!(await q(Bn)).some(l=>/U2|U3/.test(l.title)),'Ben likes it → neither copy is left in his stack');
  await A('POST','/api/listings/swipe',{listingId:otherId===flat.id?u2.id:otherId,action:'like'});
  let res=(await A('GET',`/api/groups/${g.id}/results`)).results;
  let entry=res.filter(r=>/U2|U3/.test(r.title));
  ok(entry.length===1&&entry[0].votes.length===2&&entry[0].tier==='einstimmig',`group results: one entry, 2 votes from different copies, "einstimmig" (${JSON.stringify(entry.map(e=>[e.title,e.votes.length,e.tier]))})`);
  // Ben changes his mind on the OTHER copy → only one vote of his remains
  const benOther = flat.also_on[0].id;
  await Bn('POST','/api/listings/swipe',{listingId:benOther,action:'dislike'});
  res=(await A('GET',`/api/groups/${g.id}/results`)).results; entry=res.filter(r=>/U2|U3/.test(r.title));
  const benVotes=entry[0].votes.filter(v=>v.username==='Ben');
  ok(benVotes.length===1&&benVotes[0].action==='dislike','re-rating another copy replaces the rating (one vote per person and flat)');
  const rated=(await Bn('GET','/api/listings/rated')).listings.filter(l=>/U2|U3/.test(l.title));
  ok(rated.length===1&&rated[0].my_swipe==='dislike'&&rated[0].also_on.length===1,'"Bewertet": one entry with also_on');
  // offline copy: the flat stays under "Bewertet" through the other portal
  await Bn('POST',`/api/listings/${rated[0].id}/report-offline`); await wait(300);
  const rated2=(await Bn('GET','/api/listings/rated')).listings.filter(l=>/U2|U3/.test(l.title));
  const arch=(await Bn('GET','/api/archive')).listings.filter(l=>/U2|U3/.test(l.title));
  ok(rated2.length===1&&rated2[0].id!==rated[0].id&&arch.length===0,'one copy offline → shown via the other portal, not archived');
  // not a duplicate
  const r=await Bn('POST',`/api/listings/${rated2[0].id}/not-duplicate`,{otherId:rated[0].id});
  ok(r.success,'"Kein Duplikat" accepted');
  const det=(await Bn('GET',`/api/listings/${rated2[0].id}`)).listing;
  ok(!det.cluster_id&&det.also_on.length===0,'after "Kein Duplikat" the two are separate');
  console.log('── Agent zurücksetzen');
  const rs=await Bn('POST',`/api/jobs/${j2.id}/reset`); await wait(800);
  ok(rs.removed===2,`reset removes only what this agent alone found (removed ${rs.removed}, U1 stays for Anna)`);
  ok((await A('GET','/api/jobs/'+j1.id+'/listings')).listings.length===1,'Anna\'s agent still has U1');
  console.log(fails?`${fails} FAILS`:'all ok');
})().catch(e=>{console.error('ERR',e);process.exit(1)});
