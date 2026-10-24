/* Поведение обновлений 24.10.2026:
   1. Массоподготовка агрегирует кампании по рецептуре волокна (одна кампания
      массы покрывает несколько кампаний КДМ/БДМ), цвет таймлайна — по
      рецептуре волокна, а не по машине-потребителю.
   2. Октябрь 2026 — текущий месяц: по каждому переделу есть запущенные
      кампании (линия «сегодня», классы done/active, статусы в реестре).
   3. Динамика волокнистого сырья: переключатели видов ЛЦ / ХЦ / BCTMP.
   4. План закупок сырья — таблица перед «Коэффициентами потребления».
   5. Раздел «Графикование кампаний»: Гант следует фильтрам шапки (период,
      направление, год), поддерживает любой набор переделов, крупный масштаб
      с прокруткой и сохраняет режим «Развернуто» при drag-and-drop. */
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

test('dispatch: gantt follows header filters and supports arbitrary unit sets',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 const nav=[...d.querySelectorAll('#nav [data-tab]')];
 assert.equal(nav[nav.length-1].dataset.tab,'dispatch','раздел в самом низу меню');
 assert.match(nav[nav.length-1].textContent,/Графикование кампаний/);
 d.querySelector('[data-tab="dispatch"]').click();
 const svg=()=>d.querySelector('.gantt-svg');
 const bars=()=>[...svg().querySelectorAll('.gantt-bar')];
 const rows=()=>[...d.querySelectorAll('.gantt-labels .gantt-rowlabel')].map(t=>t.textContent.split(' ·')[0]);
 assert.ok(svg(),'диаграмма Ганта на месте');
 /* Гант крупнее: высокие строки, толстые полосы и естественная ширина
    с горизонтальной прокруткой вместо сжатия подписей. */
 assert.equal(Number(svg().dataset.row),50);
 assert.equal(Number(svg().dataset.bar),30);
 assert.ok(Number(svg().dataset.w)>4000,'годовой Гант не сжимается до ширины колонки');
 assert.equal(Number(svg().dataset.days),365,'по умолчанию действует период шапки «Весь год»');
 assert.equal(svg().querySelectorAll('.gantt-month').length,12);
 assert.match(d.querySelector('#content').textContent,/Янв–дек 2026/);
 assert.deepEqual(rows(),['МП-1','МП-2','КДМ-9','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 assert.ok(bars().length>100);
 assert.ok(svg().querySelector('.gantt-today'),'линия «сегодня»');
 assert.ok(svg().querySelectorAll('.gantt-link').length>100);
 assert.equal(svg().querySelectorAll('.gantt-link.bad').length,0);
 /* месяц из шапки: октябрь 2026 */
 const month=d.querySelector('#month'); month.value='9'; month.dispatchEvent(new w.Event('change'));
 assert.equal(Number(svg().dataset.days),31);
 assert.equal(Number(svg().dataset.day),42);
 assert.deepEqual([...svg().querySelectorAll('.gantt-month')].map(t=>t.textContent),['Окт 2026']);
 assert.ok(bars().length>0&&bars().every(b=>/-10-/.test(b.dataset.ganttKey)),'на Ганте только октябрьские кампании');
 assert.match(d.querySelector('.dispatch-gantt-panel .panel-heading small').textContent,/Окт 2026/);
 assert.match(d.querySelector('.kpis').textContent,/Кампаний в окне\d+Окт 2026/);
 /* квартал из шапки */
 month.value='q4'; month.dispatchEvent(new w.Event('change'));
 assert.equal(Number(svg().dataset.days),92);
 assert.deepEqual([...svg().querySelectorAll('.gantt-month')].map(t=>t.textContent),['Окт 2026','Ноя 2026','Дек 2026']);
 assert.ok(bars().every(b=>/-1[012]-/.test(b.dataset.ganttKey)));
 /* направление из шапки */
 const fam=d.querySelector('#family'); fam.value='Картон'; fam.dispatchEvent(new w.Event('change'));
 assert.ok(bars().length>0);
 assert.ok(bars().every(b=>!/БДМ-7/.test(b.dataset.ganttKey)),'фильтр «Картон» убирает БДМ-7');
 assert.ok(bars().some(b=>/КДМ-9/.test(b.dataset.ganttKey)));
 /* если в выбранном срезе кампаний нет — диаграмма пустая, без выдуманных данных */
 d.querySelector('[data-dispatch-stage="bdm"]').click();
 assert.deepEqual(rows(),['БДМ-7']);
 assert.equal(bars().length,0);
 assert.ok(svg().querySelector('.gantt-empty'));
 assert.match(d.querySelector('.kpis').textContent,/Кампаний в окне0/);
 /* произвольный набор переделов, а не только один или все */
 fam.value='all'; fam.dispatchEvent(new w.Event('change'));
 d.querySelector('[data-dispatch-stage="all"]').click();
 const unit=(id)=>d.querySelector(`[data-dispatch-unit="${id}"]`);
 assert.equal(unit('МП-1').getAttribute('aria-pressed'),'true');
 unit('МП-1').click();
 assert.deepEqual(rows(),['МП-2','КДМ-9','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 assert.equal(unit('МП-1').getAttribute('aria-pressed'),'false');
 unit('КДМ-9').click();
 assert.deepEqual(rows(),['МП-2','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 d.querySelector('[data-dispatch-stage="mass"]').click();
 assert.deepEqual(rows(),['МП-1','МП-2']);
 unit('КДМ-9').click();
 assert.deepEqual(rows(),['МП-1','МП-2','КДМ-9'],'произвольный набор из трёх переделов');
 assert.ok(![...d.querySelectorAll('[data-dispatch-stage]')].some(b=>b.getAttribute('aria-pressed')==='true'),'ни одна группа не подсвечена — набор произвольный');
 assert.equal(unit('МП-1').getAttribute('aria-pressed'),'true');
 assert.equal(unit('КДМ-9').getAttribute('aria-pressed'),'true');
 assert.equal(unit('БДМ-7').getAttribute('aria-pressed'),'false');
 /* хотя бы один передел остаётся на диаграмме */
 d.querySelector('[data-dispatch-stage="kdm"]').click();
 unit('КДМ-9').click();
 assert.deepEqual(rows(),['КДМ-9']);
 /* год из шапки */
 d.querySelector('[data-dispatch-stage="all"]').click();
 d.querySelector('[data-year="2027"]').click();
 assert.match(d.querySelector('.dispatch-gantt-panel .panel-heading small').textContent,/2027/);
 assert.ok(bars().length>0&&bars().every(b=>b.dataset.ganttKey.includes('2027-')));
 assert.equal(svg().querySelector('.gantt-today'),null,'в 2027 линии «сегодня» нет');
 /* произвольный диапазон С / ПО */
 d.querySelector('[data-year="2026"]').click();
 const from=d.querySelector('#fromMonth'),to=d.querySelector('#toMonth');
 from.value='0'; from.dispatchEvent(new w.Event('change'));
 to.value='2'; to.dispatchEvent(new w.Event('change'));
 assert.equal(Number(svg().dataset.days),90);
 assert.deepEqual([...svg().querySelectorAll('.gantt-month')].map(t=>t.textContent),['Янв 2026','Фев 2026','Мар 2026']);
 assert.ok(bars().every(b=>/-(0?[1-3])-|-0?[1-3]-/.test(b.dataset.ganttKey)));
 assert.match(d.querySelector('.dispatch-gantt-panel .panel-heading small').textContent,/Янв–мар 2026/);
 /* заказы и их цепочки не зависят от окна периода */
 assert.ok(d.querySelector('[data-search="dispatch-orders"]'));
 const orderRows=()=>[...d.querySelectorAll('table[data-table-key="dispatch-orders"] tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent));
 const chainCell=orderRows().find(cells=>/-МП-/.test(cells[7]||''));
 assert.ok(chainCell,'заказ с цепочкой кампаний по всем переделам');
 assert.match(chainCell[8],/\d{4}-\d+-(КДМ-9|БДМ-7)-\d+/);
 assert.match(chainCell[9],/ПРС-[12]-|УП-1-/);
 /* выбор заказа подсвечивает его кампании в видимом окне */
 from.value='9'; from.dispatchEvent(new w.Event('change'));
 to.value='11'; to.dispatchEvent(new w.Event('change'));
 const orderId=chainCell[1].match(/ЗК-\d+/)[0];
 d.querySelector(`[data-dispatch-order="${orderId}"]`).click();
 const hl=[...svg().querySelectorAll('.gantt-bar.hl')];
 assert.ok(hl.length>=3,'подсвечены кампании массы, машины и отделки');
 assert.ok(hl.some(b=>/-МП-/.test(b.dataset.ganttKey)));
 assert.ok(hl.some(b=>/-(КДМ-9|БДМ-7)-/.test(b.dataset.ganttKey)));
 assert.ok(hl.some(b=>/^(ПРС-[12]|УП-1)-/.test(b.dataset.ganttKey)));
 d.querySelector('[data-dispatch-order-all="clear"]').click();
 assert.equal(svg().querySelectorAll('.gantt-bar.hl').length,0);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 assert.ok(O.AS_OF==='2026-10-23');
 }finally{w.close();}
});

test('dispatch: expanded gantt survives drag-and-drop and every gantt action',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="dispatch"]').click();
 const month=d.querySelector('#month'); month.value='9'; month.dispatchEvent(new w.Event('change'));
 const panel=()=>d.querySelector('.dispatch-gantt-panel');
 const svg=()=>d.querySelector('.gantt-svg');
 const bars=()=>[...svg().querySelectorAll('.gantt-bar')];
 const toggle=()=>panel().querySelector('[data-expand-panel]');
 toggle().click();
 assert.ok(panel().classList.contains('is-expanded'));
 assert.ok(d.body.classList.contains('has-expanded-panel'));
 assert.equal(toggle().getAttribute('aria-expanded'),'true');
 assert.equal(d.querySelectorAll('.panel.is-expanded').length,1);
 /* перетаскивание без каскада прямо в развёрнутом режиме */
 d.querySelector('[data-dispatch-cascade]').click();
 assert.equal(d.querySelector('[data-dispatch-cascade]').getAttribute('aria-pressed'),'false');
 assert.ok(panel().classList.contains('is-expanded'),'переключение каскада не сбрасывает разворот');
 const day=Number(svg().dataset.day);
 const massBar=bars().find(b=>/-МП-/.test(b.dataset.ganttKey));
 const key=massBar.dataset.ganttKey,x0=Number(massBar.getAttribute('x'));
 massBar.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:400,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:400+2*day,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 assert.ok(panel().classList.contains('is-expanded'),'после перетаскивания режим «Развернуто» сохраняется');
 assert.ok(d.body.classList.contains('has-expanded-panel'));
 assert.equal(toggle().getAttribute('aria-expanded'),'true');
 assert.equal(Number(d.querySelector(`.gantt-bar[data-gantt-key="${key}"]`).getAttribute('x')),x0+2*day,'полоса сдвинулась на 2 суток');
 assert.equal(svg().querySelectorAll('.gantt-bar.moved').length,1);
 assert.ok(svg().querySelectorAll('.gantt-link.bad').length>=1);
 /* любые действия на Ганте не сбрасывают разворот */
 d.querySelector('[data-dispatch-unit="УП-1"]').click();
 assert.ok(panel().classList.contains('is-expanded'),'смена набора переделов сохраняет разворот');
 d.querySelector('[data-dispatch-links]').click();
 assert.ok(panel().classList.contains('is-expanded'),'скрытие связей сохраняет разворот');
 assert.equal(svg().querySelectorAll('.gantt-link').length,0);
 d.querySelector('[data-dispatch-links]').click();
 d.querySelector('[data-dispatch-stage="all"]').click();
 assert.ok(panel().classList.contains('is-expanded'));
 /* каскадный сдвиг в развёрнутом режиме */
 d.querySelector('[data-dispatch-cascade]').click();
 const bar2=bars().find(b=>/-МП-/.test(b.dataset.ganttKey)&&!b.classList.contains('moved'));
 bar2.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:400,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:400+day,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 assert.ok(panel().classList.contains('is-expanded'),'каскадный сдвиг сохраняет разворот');
 assert.ok(svg().querySelectorAll('.gantt-bar.moved').length>=2);
 /* сброс сдвигов */
 d.querySelector('[data-dispatch-reset]').click();
 assert.ok(panel().classList.contains('is-expanded'),'сброс сдвигов сохраняет разворот');
 assert.equal(svg().querySelectorAll('.gantt-bar.moved').length,0);
 /* фильтры шапки не закрывают развёрнутую панель */
 month.value='10'; month.dispatchEvent(new w.Event('change'));
 assert.ok(panel().classList.contains('is-expanded'),'смена месяца в шапке сохраняет развёрнутый Гант');
 assert.equal(Number(svg().dataset.days),30);
 /* обычное сворачивание и уход в другой раздел */
 toggle().click();
 assert.equal(d.querySelectorAll('.panel.is-expanded').length,0);
 toggle().click();
 assert.ok(panel().classList.contains('is-expanded'));
 d.querySelector('[data-tab="production"]').click();
 assert.equal(d.querySelectorAll('.panel.is-expanded').length,0,'смена раздела закрывает разворот');
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 }finally{w.close();}
});
