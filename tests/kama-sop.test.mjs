import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import M from '../assets/kama-model.js';
const plans=M.scenarios.map(c=>M.run(c));
test('S&OP: complete catalog, annual monthly scope and synthetic network',()=>{
 assert.equal(M.products.length,12);assert.equal(M.skus.length,72);assert.equal(M.clients.length,24);assert.equal(M.nodes.length,7);assert.equal(M.months.length,12);
 assert.ok(M.products.some(p=>p.id==='sc'));assert.ok(M.products.some(p=>p.id==='medical'));assert.ok(M.products.some(p=>p.id==='bulk'));
 assert.equal(new Set(M.skus.map(s=>s.id)).size,72);
 for(const r of plans){assert.equal(r.rows.length,864);assert.equal(r.capacities.length,24);assert.equal(r.ledgers.length,6048);assert.equal(r.resources.length,36);}
});
test('S&OP: all five versions reconcile stock, mass, hours, supply, customers and finance',()=>{
 for(const r of plans)for(const check of r.checks)assert.ok(check.ok,`${r.config.id}: ${check.name}`);
 for(const r of plans){for(const row of r.rows){assert.ok(Number.isFinite(row.margin));assert.ok(Number.isFinite(row.revenue));}assert.ok(r.total.coverage>.85&&r.total.coverage<=1);}
});
test('S&OP: reproducible data, equal demand and genuinely distinct decisions',()=>{
 assert.deepEqual(M.run(M.scenarios[0]),plans[0]);
 for(const r of plans)assert.equal(r.total.demand,plans[0].total.demand);
 assert.equal(new Set(plans.map(r=>r.total.production)).size,5);
 assert.ok(plans[3].total.margin<plans[0].total.margin);
});
test('S&OP: machine allocation, contiguous campaign hours and integer patterns',()=>{
 for(const r of plans){
  for(const c of r.campaigns){assert.equal(M.products.find(p=>p.id===c.product).machine,c.machine);assert.ok(Math.abs(c.end-c.start-c.setup-c.run)<1e-7);}
  for(const cap of r.capacities){const cs=r.campaigns.filter(c=>c.month===cap.month&&c.machine===cap.machine);assert.ok(Math.abs(M.sum(cs,c=>c.run+c.setup)-cap.used)<1e-7);for(let i=1;i<cs.length;i++)assert.ok(Math.abs(cs[i].start-cs[i-1].end)<1e-7);}
  for(const c of r.cuts){const width=M.sum(c.pattern.split(' + '),s=>{const [n,w]=s.split('×').map(Number);assert.ok(Number.isInteger(n));return n*w;});assert.equal(width,c.used);assert.ok(Math.abs(c.trim-(1-width/c.deckle))<1e-9);}
 }
});
test('S&OP: stock continuity and monthly customer demand reconcile',()=>{
 for(const r of plans){
 for(const s of M.skus)for(const node of M.nodes){const ls=r.ledgers.filter(l=>l.sku===s.id&&l.node===node.id);for(let m=1;m<12;m++)assert.equal(ls[m].start,ls[m-1].end);}
 for(let m=0;m<12;m++){assert.ok(Math.abs(M.sum(r.customerRows.filter(x=>x.month===m),'demand')-M.sum(r.rows.filter(x=>x.month===m),'demand'))<1e-6);}
 }
});
test('S&OP: parameter extremes retain integrity; stress copy keeps supply assumptions',()=>{
 for(const demandScale of [.75,1.25])for(const cost of [.8,1.5]){
 const r=M.run(M.scenarios[4],{demandScale,cost,extra:240});assert.ok(r.checks.every(c=>c.ok),JSON.stringify(r.checks));
 }
 const stress=plans[3],copy=M.run({...M.scenarios[3],id:'custom'});assert.deepEqual(copy.resources,stress.resources);
});
function browser(){const dom=new JSDOM(readFileSync(new URL('../assets/kama.html',import.meta.url),'utf8'),{url:'http://localhost:8080',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;w.eval(readFileSync(new URL('../assets/kama-model.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-analytics.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-orders.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-app.js',import.meta.url),'utf8'));return dom;}
test('S&OP UI: every section and filter renders without DB or browser errors',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 assert.match(d.querySelector('h1').textContent,/Обзор/);assert.equal(d.querySelectorAll('#scenario option').length,5);
 for(const tab of ['demand','production','resources','network','finance','compare','capacity','overview']){d.querySelector(`[data-tab="${tab}"]`).click();assert.ok(d.querySelector('#content').textContent.length>200);assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));}
 for(const family of ['Бумага','Картон','all']){const el=d.querySelector('#family');el.value=family;el.dispatchEvent(new w.Event('change'));for(const tab of ['production','network','compare']){d.querySelector(`[data-tab="${tab}"]`).click();assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));}}
 d.querySelector('#month').value='4';d.querySelector('#month').dispatchEvent(new w.Event('change'));d.querySelector('[data-tab="production"]').click();assert.ok(d.querySelector('#content').textContent.includes('Май'));
 assert.equal(d.querySelectorAll('script[src*="inplan-"]').length,0);
 }finally{w.close();}
});
test('S&OP UI: search, pagination, scenario comparison, custom copy and Excel export',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="production"]').click();d.querySelector('[data-page="campaigns-mass"][data-step="1"]').click();
 const regPager=d.querySelector('[data-search="campaigns-mass"]').closest('.panel').querySelector('.pager span');assert.match(regPager.textContent.trim(),/^2 \/ \d+$/);
 const search=d.querySelector('[data-search="campaigns-mass"]');search.value='pharma';search.dispatchEvent(new w.Event('input'));assert.match(d.querySelector('#content').textContent,/Pharma/);
 d.querySelector('#demand-input').value='110';d.querySelector('#cost-input').value='120';d.querySelector('#repair-input').value='100';d.querySelector('#editor').close=()=>{};
 d.querySelector('#scenario-name').value='Тестовый сценарий';d.querySelector('#editor-form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(d.querySelector('#scenario').value,'custom');assert.equal(d.querySelector('#scenario option:checked').textContent,'Тестовый сценарий');assert.equal(JSON.parse(w.localStorage.getItem('kama_sop_customs_v2'))[0].name,'Тестовый сценарий');
 d.querySelector('[data-tab="compare"]').click();assert.equal(d.querySelector('#compare-b').value,'custom');d.querySelector('#compare-a').value='stress';d.querySelector('#compare-a').dispatchEvent(new w.Event('change'));assert.equal(d.querySelector('#compare-a').value,'stress');
 w.eval(readFileSync(new URL('../assets/xlsx.full.min.js',import.meta.url),'utf8'));let exported;w.XLSX.writeFile=(wb,name)=>{exported={wb,name};};d.querySelector('#export').click();assert.ok(exported);assert.equal(exported.wb.SheetNames.length,17);assert.equal(w.XLSX.utils.sheet_to_json(exported.wb.Sheets['План SKU']).length,864);assert.match(exported.name,/custom/);
 }finally{w.close();}
});
test('S&OP UI: campaign registry switches streams, default mass prep, stage-specific columns',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="production"]').click();
 const buttons=[...d.querySelectorAll('[data-registry-stream]')];assert.deepEqual(buttons.map(b=>b.dataset.registryStream),['mass','kdm','bdm','fin']);
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-pressed')),['true','false','false','false']);
 const counts=buttons.map(b=>Number(b.textContent.match(/\((\d+)\)/)[1]));
 assert.ok(counts.every(n=>n>0));
 assert.ok(counts[0]<counts[1]+counts[2],'агрегация: кампаний массоподготовки меньше, чем кампаний КДМ+БДМ');
 assert.equal(counts[3],2*(counts[1]+counts[2]),'отделка: ПРС + УП на каждую машинную кампанию');
 const heads=()=>[...d.querySelectorAll('table[data-table-key^="campaigns-"] thead th')].map(th=>th.textContent.replace(/\s*[▲▼]\s*$/,''));
 const cells=(col)=>[...d.querySelectorAll('table[data-table-key^="campaigns-"] tbody tr')].map(tr=>tr.children[col].textContent);
 assert.ok(d.querySelector('table[data-table-key="campaigns-mass"]'));
 assert.ok(heads().includes('Рецептура массы'));assert.ok(heads().includes('Покрывает кампании'));assert.ok(heads().includes('Снабжает'));assert.ok(heads().includes('Статус'));assert.ok(!heads().includes('Брутто, т'));
 assert.ok(cells(2).every(v=>v==='МП-1'||v==='МП-2'));
 assert.ok(cells(3).every(v=>['Мелованная масса GC','Мелованная масса LWC','BCTMP-пухлая масса','Немелованная офсетная масса'].includes(v)));
 assert.match(cells(4)[0],/^\d+([.,]\d+)?% \/ \d+([.,]\d+)?% \/ \d+([.,]\d+)?%$/);
 assert.ok(cells(8).every(v=>/^\d{4}-\d+-(КДМ-9|БДМ-7)-\d+( \+ \d+)* \(\d+\)$/.test(v)));
 assert.ok(cells(8).some(v=>Number(v.match(/\((\d+)\)$/)[1])>=2),'есть кампании массы, покрывающие ≥2 кампаний машины');
 assert.ok(cells(11).every(v=>v==='КДМ-9'||v==='БДМ-7'));
 assert.ok(cells(16).every(v=>['Факт','План','Идёт сейчас','Выполнена'].includes(v)));
 assert.ok(cells(16).includes('Факт'),'янв–сен 2026 — факт');
 d.querySelector('[data-registry-stream="kdm"]').click();
 assert.equal(d.querySelector('[data-registry-stream="kdm"]').getAttribute('aria-pressed'),'true');
 assert.ok(d.querySelector('table[data-table-key="campaigns-kdm"]'));
 assert.ok(heads().includes('Брутто, т'));assert.ok(heads().includes('Обрезь, т'));assert.ok(heads().includes('Статус'));assert.ok(!heads().includes('Снабжает'));
 assert.ok(cells(2).every(v=>v==='КДМ-9'));
 d.querySelector('[data-registry-stream="bdm"]').click();
 assert.ok(d.querySelector('table[data-table-key="campaigns-bdm"]'));assert.ok(cells(2).every(v=>v==='БДМ-7'));
 d.querySelector('[data-registry-stream="fin"]').click();
 assert.ok(d.querySelector('table[data-table-key="campaigns-fin"]'));
 assert.ok(heads().includes('Источник'));assert.ok(heads().includes('Годный, т'));assert.ok(heads().includes('Статус'));assert.ok(!heads().includes('Брутто, т'));
 assert.ok(cells(2).every(v=>v==='ПРС-1'||v==='ПРС-2'||v==='УП-1'));assert.ok(cells(5).every(v=>v==='КДМ-9'||v==='БДМ-7'));
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 }finally{w.close();}
});
