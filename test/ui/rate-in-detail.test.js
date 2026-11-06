const BASE = process.env.TEST_BASE;            // set by test/run.js
const { chromium, launchOptions } = require('../helpers/browser');
(async()=>{
 const [W,H]=[+process.argv[3]||390,+process.argv[4]||844]; const mob=W<900;
 const b=await chromium.launch(launchOptions);
 const page=await (await b.newContext({viewport:{width:W,height:H},hasTouch:mob,isMobile:mob})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
 let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c) fails++;};
 await page.goto(BASE+'/');
 await page.evaluate(()=>fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'anna@x.de',password:'secret123'})}));
 await page.reload(); await page.waitForSelector('.swipe-card',{timeout:8000}); await page.waitForTimeout(400);
 const bar=()=>page.evaluate(()=>({shown:getComputedStyle(document.getElementById('detail-rate-bar')).display!=='none', swipe:getComputedStyle(document.getElementById('detail-swipe-actions')).display!=='none', pressed:[...document.querySelectorAll('#detail-rate-bar [aria-pressed="true"]')].map(b=>b.dataset.rate).join(','), label:document.getElementById('detail-rate-label').textContent}));
 // from the swipe stack: swipe bar, no rating bar
 if (mob) { await page.click('.swipe-card [data-open-detail]'); await page.waitForTimeout(400); let s=await bar(); ok(s.swipe&&!s.shown,'swipe stack: swipe buttons, no rating bar'); await page.click('#detail-close'); await page.waitForTimeout(300); }
 // setup: group + a like
 const lid=await page.evaluate(async()=>{ await fetch('/api/groups/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'WG'})}); const id=state.swipeQueue[0].id; await fetch('/api/listings/swipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId:id,action:'like'})}); return id; });
 await page.click('.tab-nav[data-tab="groups"]'); await page.waitForSelector('.group-card'); await page.click('.group-card'); await page.waitForTimeout(900);
 const card=page.locator(`#group-detail-content .list-card[data-listing-id="${lid}"]`);
 ok(await card.count()===1,'liked listing shows in group results');
 await card.locator('[data-open-detail]').click(); await page.waitForTimeout(500);
 let s=await bar(); ok(s.shown&&!s.swipe&&s.pressed==='like'&&s.label==='Deine Bewertung','group → detail: rating bar, current "like" highlighted '+JSON.stringify(s));
 await page.screenshot({path:process.argv[2]+`/rate-detail-${mob?'m':'d'}.png`});
 await page.click('#detail-rate-bar [data-rate="dislike"]'); await page.waitForTimeout(1200);
 s=await bar(); ok(s.pressed==='dislike','after tap: "Nein" highlighted, detail stays open '+JSON.stringify(s));
 const server=await page.evaluate(async id=>{ const r=await (await fetch('/api/listings/rated')).json().catch(()=>({})); const l=(r.listings||[]).find(x=>x.id===id); return l&&l.my_swipe; },lid);
 ok(server==='dislike','saved on the server ('+server+')');
 await page.click('#detail-close'); await page.waitForTimeout(900);
 const chips=await page.evaluate(id=>[...document.querySelectorAll(`#group-detail-content .list-card[data-listing-id="${id}"] .vote-chip`)].map(c=>c.className).join('|'),lid);
 ok(!/\blike\b/.test(chips.replace('dislike','')) ,'group results refreshed behind the detail view ('+chips+')');
 // from "Bewertet"
 await page.click('.tab-nav[data-tab="rated"]'); await page.waitForSelector('#view-rated .list-card'); await page.waitForTimeout(400);
 await page.locator('#view-rated .list-card [data-open-detail]').first().click(); await page.waitForTimeout(500);
 s=await bar(); ok(s.shown&&s.pressed==='dislike','Bewertet → detail: rating bar with current rating '+JSON.stringify(s));
 await page.click('#detail-rate-bar [data-rate="superlike"]'); await page.waitForTimeout(900);
 ok((await bar()).pressed==='superlike','change to Super-Like from "Bewertet"');
 console.log(fails?`${fails} FAILS`:'all ok','errors:',JSON.stringify(errs)); await b.close();
})();
