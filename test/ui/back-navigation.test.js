const BASE = process.env.TEST_BASE;            // set by test/run.js
const { chromium, launchOptions } = require('../helpers/browser');
(async()=>{
 const W=+process.argv[3]||390, H=+process.argv[4]||844, mobile=W<900;
 const b=await chromium.launch(launchOptions);
 const ctx=await b.newContext({viewport:{width:W,height:H},hasTouch:mobile,isMobile:mobile}); const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 let pass=0,fail=0; const ok=(c,m)=>{ if(c)pass++; else {fail++; console.log('✗',m);} };
 const wait=ms=>page.waitForTimeout(ms);
 const st=()=>page.evaluate(()=>({v:document.querySelector('.view.active')?.id, hash:location.hash, ov:history.state?.ov, trail:(history.state?.trail||[]).join('>'), tab:document.querySelector('.tab-nav.active')?.dataset.tab, detail:document.getElementById('detail-view').style.display, modal:[...document.querySelectorAll('.modal')].some(m=>m.style.display==='flex'), gd:document.getElementById('group-detail').style.display}));
 const tab=async t=>{await page.click(`.tab-nav[data-tab="${t}"]`); await wait(250);};
 const back=async()=>{await page.goBack(); await wait(350);};
 await page.goto(BASE+'/');
 await page.evaluate(()=>fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'anna@x.de',password:'secret123'})}));
 await page.reload(); await page.waitForSelector('.swipe-card',{timeout:8000}); await wait(300);
 let s=await st(); ok(s.v==='view-swipe'&&s.hash===''&&s.trail==='swipe'&&s.ov===0,'home '+JSON.stringify(s));
 // 5 tabs
 ok(await page.$$eval('.tab-nav',e=>e.map(x=>x.textContent.trim().replace(/^\d+/,'')).join(','))==='Swipen,Bewertet,Suche,Gruppen,Profil','tab labels');
 // tab hopping does not pile up history
 await tab('rated'); await tab('groups'); await tab('search'); await tab('me'); await tab('rated');
 s=await st(); ok(s.v==='view-rated'&&s.hash==='#/bewertet'&&s.trail==='swipe>rated','rated '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-swipe'&&s.trail==='swipe','one back from hopped tabs → home '+JSON.stringify(s));
 // Suche: agents → add → archive
 await tab('search'); s=await st(); ok(s.v==='view-jobs'&&s.tab==='search'&&s.hash==='#/suche','suche '+JSON.stringify(s));
 await page.click('[data-subtabs] [data-goto="add"] >> visible=true'); await wait(250); s=await st(); ok(s.v==='view-add'&&s.tab==='search'&&s.hash==='#/suche/hinzufuegen','sub add '+JSON.stringify(s));
 await page.click('#view-add [data-subtabs] [data-goto="archive"]'); await wait(250); s=await st(); ok(s.v==='view-archive'&&s.trail==='swipe>archive','sub archive '+JSON.stringify(s));
 await tab('swipe'); await wait(200); await tab('search'); s=await st(); ok(s.v==='view-archive','Suche reopens last segment '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-swipe','back from Suche → home');
 // Profil → Einstellungen
 await tab('me'); s=await st(); ok(s.v==='view-me'&&s.hash==='#/profil','me '+JSON.stringify(s));
 await page.click('#view-me [data-goto="settings"]'); await wait(300); s=await st(); ok(s.v==='view-settings'&&s.tab==='me'&&s.trail==='swipe>me>settings','settings '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-me'&&s.trail==='swipe>me','back → Profil hub '+JSON.stringify(s));
 await page.click('#view-me [data-goto="settings"]'); await wait(300);
 await page.click('#view-settings [data-back]'); await wait(350); s=await st(); ok(s.v==='view-me'&&s.trail==='swipe>me','Zurück-Knopf → hub '+JSON.stringify(s));
 await page.click('#view-me [data-goto="profile"]'); await wait(500); s=await st(); ok(s.v==='view-profile'&&s.trail==='swipe>me>profile','profile page '+JSON.stringify(s));
 await tab('rated'); s=await st(); ok(s.v==='view-rated'&&s.trail==='swipe>rated','tab from sub-page replaces it '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-swipe','back after that → home');
 // Detail overlay: back closes it, stays on swipe
 await page.evaluate(()=>document.querySelector('.swipe-card [data-open-detail]')?.click()); await wait(500);
 s=await st(); const detOpen = s.detail==='flex' || !mobile;
 if (s.detail==='flex') {
   ok(s.ov===1,'detail pushed an entry '+JSON.stringify(s));
   await back(); s=await st(); ok(s.detail==='none'&&s.v==='view-swipe'&&s.ov===0,'back closes detail '+JSON.stringify(s));
   // open again, close with the X (programmatic) → entry removed again
   await page.evaluate(()=>document.querySelector('.swipe-card [data-open-detail]')?.click()); await wait(400);
   await page.click('#detail-close'); await wait(400); s=await st(); ok(s.detail==='none'&&s.ov===0,'X closes + pops entry '+JSON.stringify(s));
   // lightbox above detail: back closes only the photo, then the detail
   await page.evaluate(()=>document.querySelector('.swipe-card [data-open-detail]')?.click()); await wait(400);
   await page.evaluate(()=>document.getElementById('detail-gallery-expand').click()); await wait(400);
   s=await st(); const lbOpen=await page.$eval('#lightbox',e=>e.style.display==='flex'); ok(lbOpen&&s.ov===2,'lightbox above detail '+JSON.stringify(s));
   await back(); s=await st(); ok(!(await page.$eval('#lightbox',e=>e.style.display==='flex'))&&s.detail==='flex'&&s.ov===1,'back closes only the lightbox '+JSON.stringify(s));
   await back(); s=await st(); ok(s.detail==='none'&&s.ov===0&&s.v==='view-swipe','second back closes detail '+JSON.stringify(s));
   // switching tab while the detail is open closes it without leaving stale entries
   await page.evaluate(()=>document.querySelector('.swipe-card [data-open-detail]')?.click()); await wait(400);
   await page.evaluate(()=>document.querySelector('.tab-nav[data-tab="rated"]').click()); await wait(500);
   s=await st(); ok(s.detail==='none'&&s.v==='view-rated'&&s.trail==='swipe>rated'&&s.ov===0,'tab switch closes detail '+JSON.stringify(s));
   await back(); s=await st(); ok(s.v==='view-swipe'&&s.trail==='swipe','back → home after that '+JSON.stringify(s));
 } else console.log('  (no overlay detail at this width, skipped)');
 // modal on Gruppen
 await page.goto(BASE+'/'); await page.waitForSelector('.swipe-card'); await wait(300);
 await tab('groups'); await page.click('#create-group-btn'); await wait(300); s=await st(); ok(s.modal&&s.ov===1,'modal open + entry '+JSON.stringify(s));
 await back(); s=await st(); ok(!s.modal&&s.v==='view-groups'&&s.ov===0,'back closes modal, stays on Gruppen '+JSON.stringify(s));
 // group detail level
 await page.evaluate(async()=>{await fetch('/api/groups/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'WG Test'})});});
 await tab('swipe'); await tab('groups'); await page.waitForSelector('.group-card',{timeout:5000}); await page.click('.group-card'); await wait(600);
 s=await st(); ok(s.gd!=='none'&&s.ov===1,'group detail open '+JSON.stringify(s));
 await back(); s=await st(); ok(s.gd==='none'&&s.v==='view-groups','back closes group detail '+JSON.stringify(s));
 // deep links
 await page.goto('about:blank'); await page.goto(BASE+'/#/suche/archiv'); await page.waitForSelector('.view.active',{timeout:5000}); await wait(600); s=await st(); ok(s.v==='view-archive'&&s.trail==='swipe>archive','deep link archiv '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-swipe','back from deep link → home');
 await page.goto(BASE+'/?view=settings'); await wait(800); s=await st(); ok(s.v==='view-settings'&&s.trail==='swipe>me>settings'&&!(await page.evaluate(()=>location.search)),'push link ?view=settings '+JSON.stringify(s));
 await back(); s=await st(); ok(s.v==='view-me','back → hub'); await back(); s=await st(); ok(s.v==='view-swipe','back → home');
 // logout/login resets cleanly
 await tab('me'); await page.click('#logout-btn'); await wait(500);
 ok(await page.$eval('#auth-screen',e=>e.classList.contains('active')),'logged out');
 console.log(`${pass} passed, ${fail} failed; page errors:`,JSON.stringify(errs));
 await b.close();
})();
