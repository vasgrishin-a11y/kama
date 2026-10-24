/* Поведение обновлений 24.10.2026:
   1. Массоподготовка агрегирует кампании по рецептуре волокна (одна кампания
      массы покрывает несколько кампаний КДМ/БДМ), цвет таймлайна — по
      рецептуре волокна, а не по машине-потребителю.
   2. Октябрь 2026 — текущий месяц: по каждому переделу есть запущенные
      кампании (линия «сегодня», классы done/active, статусы в реестре).
   3. Динамика волокнистого сырья: переключатели видов ЛЦ / ХЦ / BCTMP.
   4. План закупок сырья — таблица перед «Коэффициентами потребления».
   5. Раздел «Графикование кампаний»: Гант следует фильтрам шапки (период,
      направление, год), поддерживает любой набор агрегатов и группы
      «Картон» / «Бумага», клик по кампании подсвечивает её цепочку,
      завершённые кампании по умолчанию серые, а проверки показывают
      последовательность переделов, доступность мощностей и часы переходов
      к цели. Режим «Развернуто» сохраняется при drag-and-drop. */
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

test('dispatch: gantt follows header filters, unit groups and arbitrary unit sets',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 const nav=[...d.querySelectorAll('#nav [data-tab]')];
 assert.equal(nav[nav.length-1].dataset.tab,'dispatch','раздел в самом низу меню');
 assert.match(nav[nav.length-1].textContent,/Графикование кампаний/);
 d.querySelector('[data-tab="dispatch"]').click();
 const svg=()=>d.querySelector('.gantt-svg');
 const bars=()=>[...svg().querySelectorAll('.gantt-bar')];
 const rows=()=>[...d.querySelectorAll('.gantt-labels .gantt-rowlabel')].map(t=>t.textContent.split(' ·')[0]);
 const unit=(id)=>d.querySelector(`[data-dispatch-unit="${id}"]`);
 const group=(id)=>d.querySelector(`[data-dispatch-group="${id}"]`);
 const stage=(id)=>d.querySelector(`[data-dispatch-stage="${id}"]`);
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
 /* Базовый план на каждом агрегате строго последователен в точных часах.
    Setup вынесен в отдельные янтарные сегменты между полосами выпуска. */
 const sequences=new Map();
 for(const bar of bars()){
  const row=bar.getAttribute('y');if(!sequences.has(row))sequences.set(row,[]);
  sequences.get(row).push({id:bar.dataset.ganttKey,start:Number(bar.dataset.occupancyStartHour),end:Number(bar.dataset.endHour)});
 }
 for(const sequence of sequences.values()){
  sequence.sort((x,y)=>x.start-y.start);
  for(let i=1;i<sequence.length;i++)assert.ok(sequence[i].start>=sequence[i-1].end-1e-7,`${sequence[i-1].id} не накладывается на ${sequence[i].id}`);
 }
 const changeovers=[...svg().querySelectorAll('.gantt-changeover')];
 assert.ok(changeovers.length>100,'переходы визуализированы отдельно от кампаний');
 assert.ok(changeovers.every(t=>Number(t.getAttribute('width'))>0));
 assert.ok(changeovers.every(t=>/Переход|Пусковая настройка/.test(t.textContent)&&/ч/.test(t.textContent)));
 for(const transition of changeovers){
  const target=bars().find(bar=>bar.dataset.ganttKey===transition.dataset.ganttTarget);
  if(target)assert.ok(Math.abs(Number(transition.getAttribute('x'))+Number(transition.getAttribute('width'))-Number(target.getAttribute('x')))<1e-6,'переход заканчивается ровно в начале выпуска');
 }
 assert.match(d.querySelector('.gantt-legend').textContent,/переход \/ переналадка/);
 assert.ok(svg().querySelector('.gantt-today'),'линия «сегодня»');
 assert.ok(svg().querySelectorAll('.gantt-link').length>100);
 assert.equal(svg().querySelectorAll('.gantt-link.bad').length,0);
 /* карточки периода: кампании, заказы из производства, переходы к цели, мощности */
 const kpis=[...d.querySelectorAll('.kpis .kpi')].map(c=>c.textContent);
 assert.equal(kpis.length,6);
 assert.ok(kpis.some(t=>/Переходы в периоде/.test(t)&&/цель ≤/.test(t)),'карточка часов переходов против цели');
 assert.ok(kpis.some(t=>/Доля переходов в фонде/.test(t)&&/цель ≤/.test(t)),'карточка доли переходов');
 assert.ok(kpis.some(t=>/Перегрузки мощностей/.test(t)));
 const capacityPanel=()=>d.querySelector('.dispatch-capacity-panel');
 assert.ok(capacityPanel(),'проверка доступности мощностей');
 assert.match(capacityPanel().textContent,/Свободное место есть/);
 assert.match(capacityPanel().textContent,/Фонд за период, ч/);
 assert.equal(capacityPanel().querySelectorAll('tbody tr').length,7,'строка на каждый видимый агрегат');
 /* месяц из шапки: октябрь 2026 */
 const month=d.querySelector('#month'); month.value='9'; month.dispatchEvent(new w.Event('change'));
 assert.equal(Number(svg().dataset.days),31);
 assert.equal(Number(svg().dataset.day),42);
 assert.deepEqual([...svg().querySelectorAll('.gantt-month')].map(t=>t.textContent),['Окт 2026']);
 assert.ok(bars().length>0&&bars().every(b=>/-10-/.test(b.dataset.ganttKey)),'на Ганте только октябрьские кампании');
 assert.match(d.querySelector('.dispatch-gantt-panel .panel-heading small').textContent,/Окт 2026/);
 assert.match(d.querySelector('.kpis').textContent,/Кампаний в окне80/);
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
 stage('bdm').click();
 assert.deepEqual(rows(),['БДМ-7']);
 assert.equal(bars().length,0);
 assert.ok(svg().querySelector('.gantt-empty'));
 assert.match(d.querySelector('.kpis').textContent,/Кампаний в окне0/);
 /* группа продукта: Картон / Бумага / Все агрегаты */
 fam.value='all'; fam.dispatchEvent(new w.Event('change'));
 group('carton').click();
 assert.deepEqual(rows(),['МП-1','КДМ-9','ПРС-1','УП-1']);
 assert.equal(group('carton').getAttribute('aria-pressed'),'true');
 assert.equal(group('all').getAttribute('aria-pressed'),'false');
 group('paper').click();
 assert.deepEqual(rows(),['МП-2','БДМ-7','ПРС-2','УП-1']);
 assert.equal(group('paper').getAttribute('aria-pressed'),'true');
 group('all').click();
 assert.deepEqual(rows(),['МП-1','МП-2','КДМ-9','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 assert.equal(group('all').getAttribute('aria-pressed'),'true');
 /* произвольный набор агрегатов, а не только один или все */
 unit('МП-1').click();
 assert.deepEqual(rows(),['МП-2','КДМ-9','БДМ-7','ПРС-1','ПРС-2','УП-1']);
 assert.equal(unit('МП-1').getAttribute('aria-pressed'),'false');
 unit('КДМ-9').click();
 unit('МП-2').click();
 assert.deepEqual(rows(),['БДМ-7','ПРС-1','ПРС-2','УП-1'],'произвольный набор без пресетов');
 assert.ok(![group('all'),group('carton'),group('paper'),stage('mass'),stage('kdm'),stage('bdm'),stage('fin')].some(b=>b.getAttribute('aria-pressed')==='true'),'ни одна группа не подсвечена — набор произвольный');
 stage('mass').click();
 assert.deepEqual(rows(),['МП-1','МП-2']);
 unit('МП-1').click();
 assert.deepEqual(rows(),['МП-2']);
 unit('МП-2').click();
 assert.deepEqual(rows(),['МП-2'],'хотя бы один агрегат остаётся на диаграмме');
 group('all').click();
 assert.equal(rows().length,7);
 /* год из шапки */
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
 assert.match(d.querySelector('.dispatch-gantt-panel .panel-heading small').textContent,/Янв–мар 2026/);
 /* заказы: остаются только покрываемые производством, у каждого есть кампании */
 const orderRows=()=>[...d.querySelectorAll('table[data-table-key="dispatch-orders"] tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent));
 const ordersPanel=()=>d.querySelector('.dispatch-orders-panel');
 assert.match(ordersPanel().textContent,/Заказы из производства/);
 const rowsNow=orderRows();
 assert.equal(rowsNow.length,5,'в списке только заказы с покрытием исключительно из производства');
 assert.ok(rowsNow.every(cells=>!/Из запаса|запас/.test(cells[5])),'запаса в покрытии нет');
 assert.ok(rowsNow.every(cells=>/^Только производство/.test(cells[5])),'покрытие — только производство');
 assert.ok(rowsNow.every(cells=>/Производство → (завод|РЦ)/.test(cells[5])),'виден канал отгрузки с производства');
 assert.ok(rowsNow.every(cells=>/-МП-/.test(cells[7])),'у каждого заказа есть кампания массоподготовки');
 assert.ok(rowsNow.every(cells=>/\d{4}-\d+-(КДМ-9|БДМ-7)-\d+/.test(cells[8])));
 assert.ok(rowsNow.every(cells=>/ПРС-[12]-|УП-1-/.test(cells[9])));
 assert.match(ordersPanel().textContent,/Выделить все из производства \(5\)/);
 /* выбор заказа подсвечивает его кампании в видимом окне */
 from.value='9'; from.dispatchEvent(new w.Event('change'));
 to.value='11'; to.dispatchEvent(new w.Event('change'));
 const orderId=rowsNow[0][1].match(/ЗК-\d+/)[0];
 d.querySelector(`[data-dispatch-order="${orderId}"]`).click();
 assert.ok(svg().querySelectorAll('.gantt-bar.hl').length>=3,'подсвечены кампании массы, машины и отделки');
 d.querySelector('[data-dispatch-order-all="clear"]').click();
 assert.equal(svg().querySelectorAll('.gantt-bar.hl').length,0);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 assert.ok(O.AS_OF==='2026-10-23');
 }finally{w.close();}
});

test('dispatch: click highlights the campaign chain and greys the rest; completed campaigns are grey by default',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="dispatch"]').click();
 const month=d.querySelector('#month'); month.value='9'; month.dispatchEvent(new w.Event('change'));
 const svg=()=>d.querySelector('.gantt-svg');
 const bars=()=>[...svg().querySelectorAll('.gantt-bar')];
 const all=bars();
 assert.ok(all.length>20);
 /* по умолчанию завершённые кампании серые, незавершённые — цветные */
 const doneBars=()=>[...svg().querySelectorAll('.gantt-bar[data-done="1"]')];
 const liveBars=()=>[...svg().querySelectorAll('.gantt-bar[data-done="0"]')];
 assert.ok(doneBars().length>0&&liveBars().length>0);
 assert.equal(doneBars()[0].getAttribute('fill'),'#b9c2ce','завершённая кампания серая');
 assert.notEqual(liveBars()[0].getAttribute('fill'),'#b9c2ce','незавершённая — цветная');
 const toggle=()=>d.querySelector('[data-dispatch-dim-done]');
 assert.equal(toggle().getAttribute('aria-pressed'),'true','кнопка включена по умолчанию');
 toggle().click();
 assert.equal(toggle().getAttribute('aria-pressed'),'false');
 assert.notEqual(doneBars()[0].getAttribute('fill'),'#b9c2ce','отжатая кнопка возвращает цвет завершённым');
 toggle().click();
 assert.equal(doneBars()[0].getAttribute('fill'),'#b9c2ce');
 /* клик по кампании подсвечивает всю цепочку, остальные полосы серые */
 const target=bars().find(b=>/-МП-/.test(b.dataset.ganttKey));
 const key=target.dataset.ganttKey;
 target.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.equal(svg().dataset.focus,key);
 assert.equal(svg().querySelectorAll('.gantt-bar.focus').length,1);
 const rel=[...svg().querySelectorAll('.gantt-bar.rel')].map(b=>b.dataset.ganttKey);
 assert.ok(rel.length>=3,'подсвечены связанные кампании переделов');
 assert.ok(rel.some(k=>/-(КДМ-9|БДМ-7)-/.test(k)));
 assert.ok(rel.some(k=>/^(ПРС-[12]|УП-1)-/.test(k)));
 assert.equal(svg().querySelectorAll('.gantt-bar.dim').length,bars().length-rel.length-1,'все остальные полосы приглушены');
 assert.ok([...svg().querySelectorAll('.gantt-bar.dim')].every(b=>b.getAttribute('fill')==='#cfd6e1'));
 const chainDone=[...svg().querySelectorAll('.gantt-bar.rel[data-done="1"]')][0];
 if(chainDone) assert.notEqual(chainDone.getAttribute('fill'),'#cfd6e1','связанные завершённые остаются в цепочке цветными');
 assert.match(d.querySelector('.dispatch-toolbar .chart-context').textContent,/выбрана .*в цепочке/);
 assert.ok(d.querySelector('.gantt-link.dim'),'связи вне цепочки приглушены');
 /* повторный клик снимает выбор */
 const focused=()=>svg().querySelector('.gantt-bar.focus');
 focused().dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.equal(svg().dataset.focus,'');
 assert.equal(svg().querySelectorAll('.gantt-bar.dim').length,0);
 assert.equal(svg().querySelectorAll('.gantt-bar.rel').length,0);
 /* выбор другой кампании и снятие кнопкой */
 bars().find(b=>/-БДМ-7-/.test(b.dataset.ganttKey)).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.match(svg().dataset.focus,/-БДМ-7-/);
 assert.ok(d.querySelector('[data-dispatch-clear-focus]'));
 d.querySelector('[data-dispatch-clear-focus]').click();
 assert.equal(svg().dataset.focus,'');
 /* клик мимо полос снимает выбор */
 bars().find(b=>/-КДМ-9-/.test(b.dataset.ganttKey)).dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.ok(svg().dataset.focus);
 svg().dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.equal(svg().dataset.focus,'');
 /* перетаскивание не считается выбором */
 d.querySelector('[data-dispatch-cascade]').click();
 assert.equal(d.querySelector('[data-dispatch-cascade]').getAttribute('aria-pressed'),'false');
 const bar=bars().find(b=>/-МП-/.test(b.dataset.ganttKey));
 bar.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:300,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:300+Number(svg().dataset.day),bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 assert.equal(svg().dataset.focus,'','после drag-and-drop цепочка не выбирается случайно');
 assert.equal(svg().querySelectorAll('.gantt-bar.moved').length,1);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
 }finally{w.close();}
});

test('dispatch: capacity availability reacts to manual campaign moves',()=>{
 const dom=browser(),w=dom.window,d=w.document;try{
 d.querySelector('[data-tab="dispatch"]').click();
 const month=d.querySelector('#month'); month.value='9'; month.dispatchEvent(new w.Event('change'));
 const svg=()=>d.querySelector('.gantt-svg');
 const panel=()=>d.querySelector('.dispatch-capacity-panel');
 const kpiText=()=>[...d.querySelectorAll('.kpis .kpi')].map(c=>c.textContent).join('|');
 assert.match(panel().textContent,/Свободное место есть/,'в плановой последовательности перегруза нет');
 assert.match(kpiText(),/Перегрузки мощностей0/);
 assert.ok(panel().querySelector('table'),'сводка фонда по агрегатам');
 /* сдвиг без каскада: полоса заезжает на следующую кампанию того же агрегата */
 d.querySelector('[data-dispatch-cascade]').click();
 assert.equal(d.querySelector('[data-dispatch-cascade]').getAttribute('aria-pressed'),'false');
 const day=Number(svg().dataset.day);
 const kdmBar=[...svg().querySelectorAll('.gantt-bar')].find(b=>/-КДМ-9-/.test(b.dataset.ganttKey));
 const key=kdmBar.dataset.ganttKey,x0=Number(kdmBar.getAttribute('x'));
 const transition=svg().querySelector(`.gantt-changeover[data-gantt-target="${key}"]`);
 const transitionX0=Number(transition.getAttribute('x'));
 kdmBar.dispatchEvent(new w.MouseEvent('mousedown',{button:0,clientX:400,bubbles:true}));
 d.dispatchEvent(new w.MouseEvent('mousemove',{clientX:400+day,bubbles:true}));
 assert.equal(Number(transition.getAttribute('x')),transitionX0+day,'переход движется вместе с кампанией прямо во время перетаскивания');
 d.dispatchEvent(new w.MouseEvent('mouseup',{bubbles:true}));
 assert.equal(Number(d.querySelector(`.gantt-bar[data-gantt-key="${key}"]`).getAttribute('x')),x0+day);
 assert.equal(Number(d.querySelector(`.gantt-changeover[data-gantt-target="${key}"]`).getAttribute('x')),transitionX0+day);
 assert.match(panel().textContent,/Накладка кампаний/,'накладка двух кампаний на агрегате');
 assert.match(panel().textContent,/накладка /);
 assert.match(panel().textContent,/сдвинуть .* вправо/);
 assert.match(kpiText(),/Перегрузки мощностей[1-9]/);
 assert.ok(!panel().textContent.includes('Свободное место есть'));
 /* сброс сдвигов возвращает чистую проверку */
 d.querySelector('[data-dispatch-reset]').click();
 assert.match(panel().textContent,/Свободное место есть/);
 assert.match(kpiText(),/Перегрузки мощностей0/);
 assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector('#content').textContent));
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
 assert.ok(panel().classList.contains('is-expanded'),'смена набора агрегатов сохраняет разворот');
 d.querySelector('[data-dispatch-links]').click();
 assert.ok(panel().classList.contains('is-expanded'),'скрытие связей сохраняет разворот');
 assert.equal(svg().querySelectorAll('.gantt-link').length,0);
 d.querySelector('[data-dispatch-links]').click();
 d.querySelector('[data-dispatch-group="all"]').click();
 assert.ok(panel().classList.contains('is-expanded'));
 d.querySelector('[data-dispatch-dim-done]').click();
 assert.ok(panel().classList.contains('is-expanded'),'переключение серых завершённых сохраняет разворот');
 d.querySelector('[data-dispatch-dim-done]').click();
 /* выбор кампании в развёрнутом режиме */
 const focusBar=bars().find(b=>/-КДМ-9-/.test(b.dataset.ganttKey));
 focusBar.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
 assert.ok(panel().classList.contains('is-expanded'),'выбор кампании сохраняет разворот');
 assert.ok(svg().querySelectorAll('.gantt-bar.dim').length>0);
 d.querySelector('[data-dispatch-clear-focus]').click();
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
