/* Поведение обновлений 24.10.2026:
   1. Массоподготовка агрегирует кампании по рецептуре волокна (одна кампания
      массы покрывает несколько кампаний КДМ/БДМ), цвет таймлайна — по
      рецептуре волокна, а не по машине-потребителю.
   2. Октябрь 2026 — текущий месяц: по каждому переделу есть запущенные
      кампании (линия «сегодня», классы done/active, статусы в реестре).
   3. Динамика волокнистого сырья: переключатели видов ЛЦ / ХЦ / BCTMP.
   4. План закупок сырья — таблица перед «Коэффициентами потребления».
   5. Раздел «Графикование кампаний»: Гант окт–дек 2026 со связями переделов,
      drag-and-drop, каскадом, заказами и подсветкой — всё локально. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import O from '../assets/kama-orders.js';

function browser(){const dom=new JSDOM(readFileSync(new URL('../assets/kama.html',import.meta.url),'utf8'),{url:'http://localhost:8080',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;w.eval(readFileSync(new URL('../assets/kama-model.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-analytics.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-orders.js',import.meta.url),'utf8'));w.eval(readFileSync(new URL('../assets/kama-app.js',import.meta.url),'utf8'));return dom;}

test('production: mass-prep timeline aggregated by fibre recipe with its own ids and colours',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="production"]').click();
 const massStage=[...d.querySelectorAll('.campaign-stage')].find(s=>/Массоподготовка/.test(s.querySelector('h3').textContent));
 assert.ok(massStage.querySelector('.mass-legend'),'легенда рецептур волокна');
 const legend=[...massStage.querySelectorAll('.mass-legend span')];
 assert.ok(legend.filter(s=>/ЛЦ \d/.test(s.textContent)).length>=3,'в легенде отдельные рецептуры по составу волокна');
 assert.ok(legend.some(s=>/Мелованная масса GC/.test(s.title)));
 const oct=[...massStage.querySelectorAll('.campaign-machine')].map(mach=>mach.querySelector('[data-camp-month="9"]'));
 assert.ok(oct.length>=1);
 const bars=[...oct[0].querySelectorAll('.timeline i:not(.repair):not(.now-line)')];
 assert.ok(bars.length>=2&&bars.length<=8,'агрегированных кампаний массы меньше, чем машинных');
 const colors=new Set(bars.map(b=>b.style.background));
 assert.ok(colors.size>=2,'полосы окрашены по конкретным рецептурам волокна');
 assert.ok(bars.every(b=>/Мелованная масса|BCTMP-пухлая масса|Немелованная офсетная масса/.test(b.title)));
 assert.ok(bars.some(b=>/покрывает [2-9]|покрывает \d\d/.test(b.title)),'кампания массы покрывает ≥2 кампаний машины');
 assert.ok(bars.every(b=>/\d{4}-10-МП-[12]-\d\d/.test(b.title)),'собственный ID кампании массы');
 /* машины КДМ-9: кампаний больше, чем агрегированных кампаний массы */
 const kdmStage=[...d.querySelectorAll('.campaign-stage')].find(s=>/КДМ \/ БДМ/.test(s.querySelector('h3').textContent));
 const kdmOct=[...kdmStage.querySelectorAll('.campaign-machine')].find(m=>/КДМ-9/.test(m.querySelector('h4').textContent)).querySelector('[data-camp-month="9"]');
 const kdmBars=kdmOct.querySelectorAll('.timeline i:not(.repair):not(.now-line)');
 assert.ok(kdmBars.length>bars.length,'уровень агрегации на массоподготовке выше, чем на КДМ');
 }finally{w.close();}
});

test('production: October 2026 shows launched campaigns in every stage',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="production"]').click();
 const months=[...d.querySelectorAll('.campaign-month[data-camp-month="9"]')];
 assert.ok(months.length>=5);
 for(const mo of months){
  assert.ok(mo.querySelector('.timeline .now-line'),'линия «сегодня» в октябре');
  assert.match(mo.textContent,/▶ запущено \d+ из \d+/);
  const started=mo.querySelectorAll('.timeline i.done, .timeline i.active');
  assert.ok(started.length>=1,'хотя бы одна запущенная кампания у каждого агрегата');
 }
 const stages=[...d.querySelectorAll('.campaign-stage')];
 assert.equal(stages.length,3);
 for(const st of stages)assert.ok(st.querySelectorAll('.timeline i.done, .timeline i.active').length>=1,`передел уже запущен: ${st.querySelector('h3').textContent}`);
 /* реестр за октябрь: статусы запущенных и выполненных кампаний */
 d.querySelector('#month').value='9';d.querySelector('#month').dispatchEvent(new w.Event('change'));
 d.querySelector('[data-tab="production"]').click();
 const regText=d.querySelector('#content').textContent;
 assert.match(regText,/Выполнена/);
 assert.match(regText,/Идёт сейчас|План/);
 }finally{w.close();}
});

test('resources: fibre type switches ЛЦ / ХЦ / BCTMP redraw the dynamics chart',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="resources"]').click();
 const fiberPanel=d.querySelector('.resource-dynamic');
 const typeBtns=[...fiberPanel.querySelectorAll('[data-fiber-type]')];
 assert.deepEqual(typeBtns.map(b=>b.dataset.fiberType),['all','lc','sc','bctmp']);
 assert.deepEqual(typeBtns.map(b=>b.getAttribute('aria-pressed')),['true','false','false','false']);
 assert.equal(typeBtns[1].title,'Лиственная белёная (ЛЦ)');
 assert.equal(typeBtns[2].title,'Хвойная белёная (ХЦ)');
 assert.equal(typeBtns[3].title,'Белёная ХТММ (BCTMP)');
 const legend=()=>[...d.querySelector('.resource-dynamic').querySelectorAll('.legend-toggle')].map(b=>b.textContent.trim());
 assert.deepEqual(legend(),['БП','Факт','План S&OP','Месячное ограничение снабжения']);
 d.querySelector('[data-fiber-type="lc"]').click();
 assert.equal(d.querySelector('[data-fiber-type="lc"]').getAttribute('aria-pressed'),'true');
 assert.match(d.querySelector('.resource-dynamic h2').textContent,/Лиственная белёная \(ЛЦ\)/);
 assert.deepEqual(legend(),['БП','Факт','План S&OP'],'лимит снабжения общий — в разрезе вида не показывается');
 assert.match(d.querySelector('.resource-dynamic svg.chart').innerHTML,/ЛЦ/);
 d.querySelector('[data-fiber-type="bctmp"]').click();
 assert.match(d.querySelector('.resource-dynamic h2').textContent,/Белёная ХТММ \(BCTMP\)/);
 d.querySelector('[data-fiber-type="sc"]').click();
 d.querySelector('[data-resource-mode="fiber"][data-value="cost"]').click();
 assert.match(d.querySelector('.resource-dynamic h2').textContent,/Хвойная белёная \(ХЦ\)/);
 assert.match(d.querySelector('.resource-dynamic').textContent,/млн ₽/);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 d.querySelector('[data-fiber-type="all"]').click();
 d.querySelector('[data-resource-mode="fiber"][data-value="volume"]').click();
 assert.deepEqual(legend(),['БП','Факт','План S&OP','Месячное ограничение снабжения']);
 }finally{w.close();}
});

test('resources: procurement plan table sits before consumption coefficients',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="resources"]').click();
 const html=d.querySelector('#content').innerHTML;
 const iProc=html.indexOf('План закупок сырья'),iCoef=html.indexOf('Коэффициенты потребления'),iLimits=html.indexOf('Месячные ограничения снабжения');
 assert.ok(iProc>0&&iCoef>0&&iLimits>0);
 assert.ok(iLimits<iProc&&iProc<iCoef,'таблица закупок — внизу раздела, перед коэффициентами потребления');
 const panel=()=>d.querySelector('[data-search="procurement"]').closest('.panel');
 assert.match(panel().querySelector('.chart-toolbar').textContent,/Потребность за период/);
 const heads=[...panel().querySelectorAll('thead th')].map(th=>th.textContent.replace(/\s*[▲▼]\s*$/,''));
 assert.deepEqual(heads,['Месяц','Ресурс','Поставщик','Объём закупки','Ед.','Цена, ₽/ед.','Логистика, ₽/ед.','Лидтайм','Доля поставщика','Затраты, млн ₽','Покрытие лимита']);
 const rows=()=>[...panel().querySelectorAll('tbody tr')];
 assert.equal(rows().length,24);
 const text=rows().map(r=>r.textContent).join('|');
 assert.match(text,/Северное волокно/);assert.match(text,/Урал Пигмент/);assert.match(text,/Энергосбыт/);
 const search=d.querySelector('[data-search="procurement"]');search.value='водоканал';search.dispatchEvent(new w.Event('input'));
 assert.equal(rows().length,12,'вода закупается 12 месяцев');
 assert.ok(rows().every(r=>/Водоканал/.test(r.textContent)));
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 }finally{w.close();}
});

test('dispatch: gantt of all stages, links, stage filter, drag with cascade, orders highlight, local only',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 const nav=[...d.querySelectorAll('#nav [data-tab]')];
 assert.equal(nav[nav.length-1].dataset.tab,'dispatch','раздел в самом низу меню');
 assert.match(nav[nav.length-1].textContent,/Графикование кампаний/);
 d.querySelector('[data-tab="dispatch"]').click();
 const svg=()=>d.querySelector('.gantt-svg');
 assert.ok(svg(),'диаграмма Ганта на месте');
 const bars=()=>[...svg().querySelectorAll('.gantt-bar')];
 const labels=[...svg().querySelectorAll('.gantt-rowlabel')].map(t=>t.textContent);
 assert.deepEqual(labels.map(l=>l.split(' ·')[0]),['МП-1','МП-2','КДМ-9','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 assert.ok(bars().length>100);
 assert.ok(svg().querySelector('.gantt-today'),'линия «сегодня»');
 assert.match(d.querySelector('#content').textContent,/окт–дек 2026/i);
 /* связи между переделами: плановых нарушений нет */
 assert.ok(svg().querySelectorAll('.gantt-link').length>100);
 assert.equal(svg().querySelectorAll('.gantt-link.bad').length,0);
 d.querySelector('[data-dispatch-links]').click();
 assert.equal(svg().querySelectorAll('.gantt-link').length,0,'кнопка скрывает связи');
 d.querySelector('[data-dispatch-links]').click();
 /* фильтр одного передела */
 d.querySelector('[data-dispatch-stage="mass"]').click();
 assert.deepEqual([...svg().querySelectorAll('.gantt-rowlabel')].map(t=>t.textContent.split(' ·')[0]),['МП-1','МП-2']);
 assert.ok(bars().every(b=>/-МП-[12]-/.test(b.dataset.ganttKey)));
 assert.equal(svg().querySelectorAll('.gantt-link').length,0,'связи со скрытыми переделами не рисуются');
 d.querySelector('[data-dispatch-stage="kdm"]').click();
 assert.deepEqual([...svg().querySelectorAll('.gantt-rowlabel')].map(t=>t.textContent),['КДМ-9']);
 d.querySelector('[data-dispatch-stage="all"]').click();
 /* заказы раздела «Управление заказами» и их цепочки кампаний по переделам */
 assert.ok(d.querySelector('[data-search="dispatch-orders"]'));
 const orderRows=()=>[...d.querySelectorAll('table[data-table-key="dispatch-orders"] tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent));
 const orderHeads=[...d.querySelectorAll('table[data-table-key="dispatch-orders"] thead th')].map(th=>th.textContent.replace(/\s*[▲▼]\s*$/,''));
 assert.ok(orderHeads.includes('Кампании массоподготовки')&&orderHeads.includes('Кампании КДМ / БДМ')&&orderHeads.includes('Кампании отделки'));
 const chainCell=orderRows().find(cells=>/-МП-/.test(cells[7]||''));
 assert.ok(chainCell,'заказ с цепочкой кампаний по всем переделам');
 assert.match(chainCell[8],/\d{4}-\d+-(КДМ-9|БДМ-7)-\d+/);
 assert.match(chainCell[9],/ПРС-[12]-|УП-1-/);
 const orderId=chainCell[1].match(/ЗК-\d+/)[0];
 /* выбор заказа подсвечивает его кампании во всех переделах */
 d.querySelector(`[data-dispatch-order="${orderId}"]`).click();
 const hl=[...svg().querySelectorAll('.gantt-bar.hl')];
 assert.ok(hl.length>=3,'подсвечены кампании массы, машины и отделки');
 assert.ok(hl.some(b=>/-МП-/.test(b.dataset.ganttKey)));
 assert.ok(hl.some(b=>/-(КДМ-9|БДМ-7)-/.test(b.dataset.ganttKey)));
 assert.ok(hl.some(b=>/^(ПРС-[12]|УП-1)-/.test(b.dataset.ganttKey)));
 d.querySelector('[data-dispatch-order-all="clear"]').click();
 assert.equal(svg().querySelectorAll('.gantt-bar.hl').length,0);
 /* drag-and-drop без каскада: сдвиг кампании массы вправо рвёт обеспечение машины */
 d.querySelector('[data-dispatch-cascade]').click();
 assert.equal(d.querySelector('[data-dispatch-cascade]').getAttribute('aria-pressed'),'false');
 const dayOfBar=(b)=>(Number(b.getAttribute('x'))-172)/14;
 const massBar=bars().find(b=>/-МП-/.test(b.dataset.ganttKey)&&dayOfBar(b)<=45);
 assert.ok(massBar,'есть кампания массоподготовки в окт–ноя');
 const key=massBar.dataset.ganttKey,x0=Number(massBar.getAttribute('x'));
 massBar.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:400,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:400+14*14,bubbles:true}));
 assert.equal(Number(d.querySelector(`.gantt-bar[data-gantt-key="${key}"]`).getAttribute('x')),x0+14*14,'полоса идёт за мышью');
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 let moved=[...svg().querySelectorAll('.gantt-bar.moved')];
 assert.equal(moved.length,1,'без каскада сдвинута одна кампания');
 assert.ok(svg().querySelectorAll('.gantt-link.bad').length>=1,'красная связь: машина стартует раньше обеспечивающей кампании массы');
 assert.match(d.querySelector('.dispatch-violations-panel').textContent,/сдвинуть/);
 assert.match(d.querySelector('#content').textContent,/Сдвинуто вручную/);
 /* сдвиги не влияют на другие разделы, а состояние раздела сохраняется */
 d.querySelector('[data-tab="production"]').click();
 assert.ok(!/сдвинута вручную/.test(d.querySelector('#content').innerHTML));
 assert.ok(!d.querySelector('#content').innerHTML.includes('gantt-bar'));
 d.querySelector('[data-tab="dispatch"]').click();
 assert.equal(svg().querySelectorAll('.gantt-bar.moved').length,1);
 /* drag-and-drop с каскадом: кампания массы тянет машину и отделку */
 d.querySelector('[data-dispatch-cascade]').click();
 const massBar2=bars().find(b=>/-МП-/.test(b.dataset.ganttKey)&&!b.classList.contains('moved'));
 assert.ok(massBar2);
 massBar2.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:400,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:400+2*14,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 moved=[...svg().querySelectorAll('.gantt-bar.moved')];
 assert.ok(moved.length>=4,'каскад сдвинул связанные кампании следующих переделов');
 assert.ok(moved.some(b=>/-МП-/.test(b.dataset.ganttKey)));
 assert.ok(moved.some(b=>/-(КДМ-9|БДМ-7)-/.test(b.dataset.ganttKey)));
 assert.ok(moved.some(b=>/^(ПРС-[12]|УП-1)-/.test(b.dataset.ganttKey)));
 /* сброс очищает локальное состояние диспетчерской */
 d.querySelector('[data-dispatch-reset]').click();
 assert.equal(svg().querySelectorAll('.gantt-bar.moved').length,0);
 assert.equal(svg().querySelectorAll('.gantt-link.bad').length,0);
 assert.match(d.querySelector('.dispatch-violations-panel').textContent,/Нарушений нет/);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 assert.ok(O.AS_OF==='2026-10-23');
 }finally{w.close();}
});
