const BASE = process.env.TEST_BASE;            // set by test/run.js
const { chromium, launchOptions } = require('../helpers/browser');
const B=BASE;
(async()=>{
 const [W,H]=[+process.argv[3]||390,+process.argv[4]||844]; const mob=W<900;
 const b=await chromium.launch(launchOptions);
 const page=await (await b.newContext({viewport:{width:W,height:H},hasTouch:mob,isMobile:mob})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
 await page.goto(B);
 const setup=await page.evaluate(async()=>{
   const j=async(m,p,b)=>(await fetch(p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined})).json();
   await j('POST','/api/auth/register',{username:'Ben',email:'ben@x.de',password:'secret123'});
   const job=(await j('POST','/api/jobs',{label:'WG-Gruppe',search_url:'https://www.kleinanzeigen.de/s-wohnung-mieten/bremen/k0c203',visibility:'global'})).job;
   await j('POST',`/api/jobs/${job.id}/run`); return job.id; });
 await page.waitForTimeout(900); await page.reload(); await page.waitForSelector('.swipe-card',{timeout:8000}); await page.waitForTimeout(500);
 const cards=await page.$$eval('.swipe-card .card-platform',e=>e.map(x=>x.textContent.trim()));
 ok(cards.length===2&&cards.some(t=>/\+1$/.test(t)),'2 cards (U1, LEG/Immowelt as one), badge shows "+1": '+JSON.stringify(cards));
 // bring the merged flat to the top and open its detail
 await page.evaluate(()=>{ const l=state.swipeQueue.find(x=>x.also_on?.length); detailView.open(l,{fromSwipe:true}); }); await page.waitForTimeout(500);
 const box=await page.evaluate(()=>({hidden:document.getElementById('detail-also-on').hidden, text:document.getElementById('detail-also-on').innerText.replace(/\s+/g,' ').trim(), href:document.querySelector('#detail-also-on a')?.href}));
 ok(!box.hidden&&/Auch auf/.test(box.text)&&/Immowelt|LEG/.test(box.text)&&/^https:\/\/www\.(immowelt|leg-wohnen)\.de\//.test(box.href),'detail: "Auch auf" with link to the other portal: '+JSON.stringify(box));
 await page.screenshot({path:process.argv[2]+`/dup-detail-${mob?'m':'d'}.png`});
 await page.click('#detail-also-on [data-not-dup]'); await page.waitForTimeout(900);
 const after=await page.evaluate(()=>({hidden:document.getElementById('detail-also-on').hidden, n:state.swipeQueue.length, badges:[...document.querySelectorAll('.swipe-card .card-platform')].map(x=>x.textContent.trim())}));
 ok(after.hidden&&after.n===3&&!after.badges.some(t=>/\+/.test(t)),'"Kein Duplikat?" → separate again, 3 cards: '+JSON.stringify(after));
 await page.evaluate(()=>detailView.close()); await page.waitForTimeout(300);
 // re-merge for the list-card chip: like the LEG one, check "Bewertet"
 await page.evaluate(async()=>{ await fetch('/api/listings/swipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId:1,action:'like'})}); });
 await page.click('.tab-nav[data-tab="rated"]'); await page.waitForSelector('#view-rated .list-card'); await page.waitForTimeout(300);
 ok(await page.locator('#view-rated .list-card').count()===1,'"Bewertet" shows the liked listing');
 console.log(fails?`${fails} FAILS`:'all ok','errors:',JSON.stringify(errs)); await b.close();
})();
