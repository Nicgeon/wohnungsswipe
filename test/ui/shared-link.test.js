const BASE = process.env.TEST_BASE;            // set by test/run.js
const { chromium, launchOptions } = require('../helpers/browser');
(async()=>{
 const b=await chromium.launch(launchOptions);
 const page=await (await b.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
 let fails=0; const ok=(c,m)=>{console.log((c?'✓ ':'✗ ')+m); if(!c)fails++;};
 await page.goto(BASE+'/');
 await page.evaluate(()=>fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'anna@x.de',password:'secret123'})}));
 await page.goto('about:blank'); await page.goto(BASE+'/?listing=2'); await page.waitForTimeout(1200);
 const st=()=>page.evaluate(()=>({detail:document.getElementById('detail-view').style.display, q:location.search, ov:history.state?.ov, trail:history.state?.trail?.join('>')}));
 let s=await st(); ok(s.detail==='flex'&&s.q===''&&s.ov===1&&s.trail==='swipe','shared link opens detail, URL cleaned, history state intact '+JSON.stringify(s));
 await page.goBack(); await page.waitForTimeout(400); s=await st(); ok(s.detail==='none'&&s.ov===0,'back closes shared detail '+JSON.stringify(s));
 // message modal over detail → "Profil ausfüllen" link goes to the profile page and back returns to Swipen
 await page.evaluate(()=>document.querySelector('.swipe-card [data-open-detail]').click()); await page.waitForTimeout(400);
 await page.evaluate(()=>document.getElementById('detail-msg-btn').click()); await page.waitForTimeout(800);
 s=await st(); ok(await page.$eval('#message-modal',e=>e.style.display==='flex')&&s.ov===2,'message modal above detail '+JSON.stringify(s));
 const link=(await page.locator('#message-modal [data-goto-profile]:visible').count())?page.locator('#message-modal [data-goto-profile]:visible').first():null;
 if(link){ await link.click(); await page.waitForTimeout(900);
   const v=await page.evaluate(()=>({v:document.querySelector('.view.active').id, ov:history.state.ov, trail:history.state.trail.join('>'), md:document.getElementById('message-modal').style.display, dt:document.getElementById('detail-view').style.display}));
   ok(v.v==='view-profile'&&v.ov===0&&v.md==='none'&&v.dt==='none','profile link closes overlays '+JSON.stringify(v));
   await page.goBack(); await page.waitForTimeout(500); const w=await page.evaluate(()=>document.querySelector('.view.active').id); ok(w==='view-swipe','back from profile → Swipen ('+w+')');
 } else console.log('  (no profile link in message modal – skipped)');
 console.log('fails:',fails,'errors:',JSON.stringify(errs)); await b.close();
})();
