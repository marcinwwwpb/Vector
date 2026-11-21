/* global process, Buffer */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
const steps=Number(process.env.BENCH_STEPS||90);
const environment={node:process.version,browser:browser.version(),platform:process.platform,architecture:process.arch,viewport:'1440x900',stepsPerScenario:steps};
for(const count of [100,500]) {
 console.log('Start',count);
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForSelector('canvas.interaction');
 console.log('Loaded');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='#e06030';x.fillRect(0,0,64,64);return c.toDataURL();});
 const common={visible:true,locked:false,stroke:'#246080',fill:'#aaddff',width:2,matrix:[1,0,0,0,1,0,0,0,1]};
 const objects=Array.from({length:count},(_,i)=>({...common,id:'s'+i,name:'Shape '+i,kind:'rect',x:350+(i%20)*25,y:30+Math.floor(i/20)*20,w:20,h:16}));
 for(let i=0;i<3;i++)objects.push({...common,id:'img'+i,name:'Image '+i,kind:'image',x:600+i*70,y:550,w:64,h:64,pixels:png,original:png});
 objects.push({...common,id:'moving',name:'Moving',kind:'rect',x:100,y:100,w:100,h:80});
 await page.locator('input[accept^=".vlab"]').setInputFiles({name:'benchmark.vlab',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,width:960,height:640,background:'#ffffff',objects}))});
 await page.waitForTimeout(1500);
 console.log('Imported');
 if(await page.getByRole('button',{name:'100%',exact:true}).count())await page.getByRole('button',{name:'100%',exact:true}).click();
 // Camera-independent target from document boundary or original artboard.
 const box=await page.locator('canvas.interaction').boundingBox();
 const art=await page.locator('.artboard').boundingBox();
 const origin=await page.evaluate(()=>{const el=document.querySelector('[data-document-origin]');return el?JSON.parse(el.dataset.documentOrigin):null;});
 const start=origin?{x:box.x+origin.x+150*origin.zoom,y:box.y+origin.y+140*origin.zoom}:{x:art.x+150*(art.width/960),y:art.y+140*(art.width/960)};
 await page.getByRole('button',{name:'Zaznacz',exact:true}).click();
 await page.mouse.move(start.x,start.y);await page.mouse.down();
 const profiler=await page.context().newCDPSession(page);
 await profiler.send('Profiler.enable');
 await profiler.send('Profiler.start');
 await page.evaluate(()=>{
  window.__bench={frames:[],calls:{putImageData:[],drawImage:[],fillRect:[]},running:true};
  let last=performance.now();function tick(t){if(!window.__bench.running)return;window.__bench.frames.push(t-last);last=t;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  for(const name of Object.keys(window.__bench.calls)){const original=CanvasRenderingContext2D.prototype[name];CanvasRenderingContext2D.prototype[name]=function(...args){const t=performance.now();const result=original.apply(this,args);if(window.__bench.running)window.__bench.calls[name].push(performance.now()-t);return result;};}
 });
 for(let i=0;i<steps;i++){await page.mouse.move(start.x+i*1.7,start.y+Math.sin(i/12)*30);await page.waitForTimeout(8);if(i%30===0)console.log('Move',i);}
 await page.mouse.up();
 const data=await page.evaluate(()=>{window.__bench.running=false;return window.__bench;});
 const {profile}=await profiler.send('Profiler.stop');
 const nodes=new Map(profile.nodes.map(n=>[n.id,n]));
 const parents=new Map();for(const n of profile.nodes)for(const child of n.children||[])parents.set(child,n.id);
 const cpu={raster:0,react:0,pointer:0,composition:0,other:0};
 profile.samples.forEach((id,i)=>{const stack=[];for(let n=id;n;n=parents.get(n))stack.push(nodes.get(n)?.callFrame.functionName||'');const category=stack.some(n=>/^(drawShape|pixel|polygonFill|circle|line)$/.test(n))?'raster':stack.some(n=>/^(pointerMove|pointerUp|pointerDown)$/.test(n))?'pointer':stack.some(n=>/renderWithHooks|performWorkOnRoot|commitRoot|beginWork/.test(n))?'react':stack.some(n=>/^(render|compose|paint)$/.test(n))?'composition':'other';cpu[category]+=(profile.timeDeltas[i]||0)/1000;});
 const sorted=data.frames.slice(2).sort((a,b)=>a-b);
 results.push({count,images:3,frames:sorted.length,median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],cpuSampleMs:cpu,canvasCalls:Object.fromEntries(Object.entries(data.calls).map(([k,v])=>[k,{count:v.length,totalMs:v.reduce((a,b)=>a+b,0)}]))});
 await page.close();
}
await browser.close();
const report={environment,results};
console.log(JSON.stringify(report,null,2));
await writeFile(process.argv[2]||'benchmark-results.json',JSON.stringify(report,null,2));
