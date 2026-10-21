/* Autonomous, deterministic S&OP demonstration. Public facts and synthetic assumptions are separated in docs. */
(function(root){
'use strict';
const months=['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const products=[
 ['bright','КАМА Bright GC1','Картон',190,220,89000,57000,49000],
 ['strong','КАМА Strong GC2','Картон',250,300,82000,53000,65000],
 ['project','КАМА Project GC2','Картон',250,300,79000,51500,44000],
 ['pharma','КАМА Pharma GC1','Картон',250,300,98000,60500,38000],
 ['tobacco1','Tobacco Premium GC1','Картон',210,230,103000,64000,28000],
 ['tobacco2','Tobacco Premium GC2','Картон',210,230,94000,58500,25000],
 ['lwc','LWC Урал Брайт · глянцевая','Бумага',60,80,79000,53500,27000],
 ['satin','LWC Урал Брайт · полуглянцевая','Бумага',60,80,81500,55000,18000],
 ['medical','Офсетная для мед. инструкций','Бумага',45,50,85000,56500,10000],
 ['offset','Офсетная+','Бумага',65,80,69000,48000,19000],
 ['bulk','Офсетная пухлая+','Бумага',60,70,73500,49500,11000],
 ['sc','Суперкаландрированная','Бумага',56,60,71000,49000,9000]
].map(([id,name,family,g1,g2,price,cost,annual],i)=>({id,name,family,grams:[g1,g2],price,cost,annual,machine:i<6?'КДМ-9':'БДМ-7',widths:i<6?[700,900,1000]:[630,840,1050],deckle:i<6?3600:4200,rate:i<6?34:13.5,fiber:i<6?.79:.84,coat:i<6?.15:(i<8?.09:.015),energy:i<6?1.1:1.25}));
const skus=products.flatMap(p=>p.grams.flatMap((gram,g)=>p.widths.map((width,w)=>({id:`${p.id}-${gram}-${width}`,product:p.id,name:p.name,family:p.family,gram,width,g,w,share:[.42,.33,.25][w]*[.58,.42][g]}))));
const nodes=[{id:'plant',name:'Заводской склад · Краснокамск',cap:16000,share:.55,freight:0,last:1650,days:0},{id:'center',name:'РЦ Центр · условный',cap:4200,share:.28,freight:2400,last:950,days:4},{id:'volga',name:'РЦ Поволжье · условный',cap:3000,share:.17,freight:1550,last:1050,days:3}];
const segments=['Фармацевтическая упаковка','Пищевая упаковка','Косметика и бытовая химия','Табачная упаковка','Издательства и типографии','Дистрибьюторы'];
const clients=Array.from({length:24},(_,i)=>({id:`ДЕМО-${String(i+1).padStart(2,'0')}`,name:`Покупатель ${String(i+1).padStart(2,'0')}`,segment:segments[Math.floor(i/4)],node:nodes[i%3].id,weight:1+(i%4)*.15}));
const scenarios=[
 {id:'base',name:'V1 · Базовый план',short:'Базовый',desc:'Продуктовый порядок, обычный страховой запас.',target:.2,priority:'base',setup:1,cost:1,extra:0},
 {id:'margin',name:'V2 · Приоритет маржинального дохода',short:'Маржа',desc:'Первый проход — целевое покрытие 65%, затем более доходные группы; выполнение минимума проверяется по результату.',target:.12,priority:'margin',setup:1,cost:1,extra:0},
 {id:'service',name:'V3 · Приоритет сервиса',short:'Сервис',desc:'Больше страхового запаса, приоритет покрытия спроса.',target:.48,priority:'service',setup:1,cost:1,extra:0},
 {id:'stress',stress:true,name:'V4 · Ремонт и ресурсный стресс',short:'Стресс',desc:'Дополнительные 144 ч ремонта КДМ-9 в мае, сырьё дороже на 12%, поставки волокна −8%.',target:.2,priority:'base',setup:1,cost:1.12,extra:144},
 {id:'balanced',name:'V5 · Сбалансированный план',short:'Баланс',desc:'Группировка кампаний, запас перед ремонтом, приоритет обязательств.',target:.3,priority:'balanced',setup:.72,cost:1,extra:0}
];
const sum=(a,k)=>a.reduce((s,r,i)=>s+(typeof k==='function'?k(r,i):r[k]||0),0);
function demand(s,m,scale=1){const p=products.find(p=>p.id===s.product);const seasonal=p.family==='Картон'?[.87,.9,.99,.96,.98,1,1.02,1.08,1.13,1.15,1.06,.86]:[.88,.91,.97,1.02,.98,.87,.91,1.12,1.17,1.16,1.12,.89];return p.annual*s.share*seasonal[m]/sum(seasonal,x=>x)*scale;}
function patterns(widths,deckle){const out=[];for(let a=0;a<=Math.floor(deckle/widths[0]);a++)for(let b=0;b<=Math.floor(deckle/widths[1]);b++)for(let c=0;c<=Math.floor(deckle/widths[2]);c++){const used=a*widths[0]+b*widths[1]+c*widths[2];if(used>0&&used<=deckle)out.push({counts:[a,b,c],used,trim:1-used/deckle});}return out;}
const patternMap=Object.fromEntries(products.map(p=>[p.id,patterns(p.widths,p.deckle)]));
function run(config,overrides={}){
 const cfg={...config,...overrides};cfg.demandScale=Math.max(.75,Math.min(1.25,Number(cfg.demandScale)||1));cfg.extra=Math.max(0,Math.min(240,Number(cfg.extra)||0));cfg.cost=Math.max(.8,Math.min(1.5,Number(cfg.cost)||1));
 const rows=[],campaigns=[],cuts=[],capacities=[],ledgers=[],resources=[],customerRows=[];
 const stock={};for(const s of skus)stock[s.id]=nodes.map(n=>demand(s,0,cfg.demandScale)*.32*({plant:.65,center:.22,volga:.13}[n.id]));
 const initial=sum(Object.values(stock),a=>sum(a,x=>x));const previous={};
 for(let m=0;m<12;m++){
  const start=Object.fromEntries(skus.map(s=>[s.id,[...stock[s.id]]]));const made=Object.fromEntries(skus.map(s=>[s.id,0]));
  const available={fiber:(m===4?24400:26700)*(cfg.stress?.92:1),coat:4100,energy:38200};const used={fiber:0,coat:0,energy:0};
  for(const machine of ['КДМ-9','БДМ-7']){
   const days=[31,28,31,30,31,30,31,31,30,31,30,31][m];const repair=(machine==='КДМ-9'?(m===4?120:20):(m===6?72:16))+(machine==='КДМ-9'&&m===4?cfg.extra:0);const hours=days*24-repair;let elapsed=0,setupTotal=0,runTotal=0;
   let jobs=products.filter(p=>p.machine===machine).flatMap(p=>p.grams.map(gram=>({p,gram})));
   if(cfg.priority==='margin')jobs.sort((a,b)=>(b.p.price-b.p.cost)*b.p.rate-(a.p.price-a.p.cost)*a.p.rate);
   if(cfg.priority==='service')jobs.sort((a,b)=>a.p.id==='pharma'?-1:b.p.id==='pharma'?1:a.gram-b.gram);
   if(cfg.priority==='balanced')jobs.sort((a,b)=>a.p.id.localeCompare(b.p.id)||a.gram-b.gram);
   // Minimum commitment pass prevents a high-margin mix from consuming the entire machine.
   const passes=cfg.priority==='margin'?[.65,1]:[1];
   for(const pass of passes)for(const {p,gram} of jobs){
    const ss=skus.filter(s=>s.product===p.id&&s.gram===gram);const need=ss.map(s=>{
     const d=demand(s,m,cfg.demandScale);const target=cfg.target+(cfg.priority==='balanced'&&((machine==='КДМ-9'&&m===3)||(machine==='БДМ-7'&&m===5))?.3:0);
     return Math.max(0,d*pass+(pass===1?demand(s,Math.min(11,m+1),cfg.demandScale)*target:0)-sum(stock[s.id],x=>x)-made[s.id]);});
    if(sum(need,x=>x)<8)continue;
    const prev=previous[machine];const setup=(prev? (prev.product!==p.id?4.5:1.5)+Math.abs(prev.gram-gram)*.025:4)*cfg.setup;
    if(elapsed+setup+1>hours)continue;
    const begin=elapsed;let grossTotal=0,goodTotal=0,trimTotal=0;const campaignCuts=[];const capacityLeft=hours-elapsed-setup;
    const rate=p.rate*(gram/p.grams[0])**.12;const quality=p.family==='Картон'?.985:.98;
    for(let iteration=0;iteration<150&&sum(need,x=>x)>8;iteration++){
     let best=null,bestScore=-1;
     for(const pattern of patternMap[p.id]){
      const outputs=pattern.counts.map((n,i)=>n*p.widths[i]/p.deckle*quality);const gross=Math.min(100,(capacityLeft-grossTotal/rate)*rate,(available.fiber-used.fiber)/p.fiber,(available.coat-used.coat)/p.coat,(available.energy-used.energy)/p.energy);
      if(gross<2)continue;
      const useful=sum(outputs,(f,i)=>Math.min(need[i],f*gross));const excess=sum(outputs,(f,i)=>Math.max(0,f*gross-need[i]));const score=(useful-excess*.85)/gross-pattern.trim*.12;
      if(score>bestScore){bestScore=score;best={pattern,outputs,gross};}
     }
     if(!best||bestScore<.25)break;
     const {pattern,outputs}=best;let gross=best.gross;const ratios=outputs.map((f,i)=>f>0&&need[i]>0?need[i]/f:0);gross=Math.min(gross,Math.max(...ratios));if(gross<2)break;
     outputs.forEach((f,i)=>{made[ss[i].id]+=gross*f;need[i]=Math.max(0,need[i]-gross*f);});
     const good=sum(outputs,x=>x)*gross;const trim=gross*pattern.trim;grossTotal+=gross;goodTotal+=good;trimTotal+=trim;
     used.fiber+=gross*p.fiber;used.coat+=gross*p.coat;used.energy+=gross*p.energy;
     campaignCuts.push({month:m,machine,product:p.id,gram,pattern:pattern.counts.map((n,i)=>n?`${n}×${p.widths[i]}`:'').filter(Boolean).join(' + '),deckle:p.deckle,used:pattern.used,trim:pattern.trim,gross,good,qualityLoss:gross-trim-good});
    }
    if(grossTotal){const id=`${m+1}-${machine}-${campaigns.length+1}`;elapsed+=setup+grossTotal/rate;setupTotal+=setup;runTotal+=grossTotal/rate;previous[machine]={product:p.id,gram};campaigns.push({id,month:m,machine,product:p.id,gram,start:begin,end:elapsed,setup,run:grossTotal/rate,gross:grossTotal,good:goodTotal,trim:trimTotal});cuts.push(...campaignCuts.map(c=>({...c,campaign:id})));}
   }
   capacities.push({month:m,machine,calendar:days*24,repair,available:hours,setup:setupTotal,run:runTotal,used:elapsed,load:elapsed/hours});
  }
  resources.push(...Object.keys(used).map(id=>({month:m,id,available:available[id],used:used[id]})));
  for(const s of skus){
   const p=products.find(p=>p.id===s.product),d=demand(s,m,cfg.demandScale),st=stock[s.id];st[0]+=made[s.id];
   const transfers=[0,0,0],sales=[0,0,0];
   // Dispatch direct orders first; regional replenishment is same-month (3–4 day transit).
   sales[0]=Math.min(st[0],d*nodes[0].share);st[0]-=sales[0];
   for(let n=1;n<3;n++){const target=d*nodes[n].share*cfg.target;const maxNodeRoom=Math.max(0,nodes[n].cap-sum(skus,t=>stock[t.id][n]));const req=Math.max(0,d*nodes[n].share+target-st[n]);const move=Math.min(st[0],req,maxNodeRoom);st[0]-=move;st[n]+=move;transfers[n]=move;sales[n]=Math.min(st[n],d*nodes[n].share);st[n]-=sales[n];}
   const shipped=sum(sales,x=>x),price=p.price*(1+m*.002),unitCost=p.cost*(1+(cfg.cost-1)*.65);const logistics=sum(nodes,(n,i)=>sales[i]*n.last+transfers[i]*n.freight);const holding=sum(nodes,(n,i)=>(start[s.id][i]+st[i])/2*(i?680:420));const revenue=shipped*price,variable=shipped*unitCost;
   rows.push({month:m,sku:s.id,product:p.id,family:p.family,demand:d,production:made[s.id],sales:shipped,gap:d-shipped,start:sum(start[s.id],x=>x),end:sum(st,x=>x),target:d*cfg.target,revenue,variable,logistics,holding,margin:revenue-variable-logistics-holding,price,unitCost});
   nodes.forEach((n,i)=>ledgers.push({month:m,sku:s.id,node:n.id,start:start[s.id][i],production:i===0?made[s.id]:0,inbound:i?transfers[i]:0,outbound:i===0?sum(transfers,x=>x):0,sales:sales[i],end:st[i]}));
   const segment=p.id==='pharma'||p.id==='medical'?0:p.id.startsWith('tobacco')?3:p.family==='Бумага'?4:p.id==='bright'?2:1;
   for(let n=0;n<3;n++){const buyers=clients.filter(c=>c.node===nodes[n].id&&(c.segment===segments[segment]||c.segment===segments[5]));const totalWeight=sum(buyers,'weight');buyers.forEach(c=>customerRows.push({month:m,client:c.id,sku:s.id,node:c.node,demand:d*nodes[n].share*c.weight/totalWeight,sales:sales[n]*c.weight/totalWeight}));}
  }
 }
 const total={demand:sum(rows,'demand'),sales:sum(rows,'sales'),production:sum(rows,'production'),revenue:sum(rows,'revenue'),margin:sum(rows,'margin'),logistics:sum(rows,'logistics'),holding:sum(rows,'holding'),gap:sum(rows,'gap'),initial,end:sum(rows.filter(r=>r.month===11),'end'),trim:sum(cuts,c=>c.gross*c.trim),gross:sum(campaigns,'gross')};total.coverage=total.sales/total.demand;
 const result={config:cfg,rows,campaigns,cuts,capacities,ledgers,resources,customerRows,total};result.checks=validate(result);return result;
}
function validate(r){const tol=1e-6;return [
 ['Баланс каждого SKU / склада / месяца',r.ledgers.every(l=>Math.abs(l.start+l.production+l.inbound-l.outbound-l.sales-l.end)<tol)],
 ['Годный выпуск кампаний сходится с планом SKU',Math.abs(sum(r.campaigns,'good')-r.total.production)<tol],
 ['Межскладские приход и расход сходятся',Math.abs(sum(r.ledgers,'inbound')-sum(r.ledgers,'outbound'))<tol],
 ['Неотрицательные остатки',r.ledgers.every(l=>l.end>=-tol)],
 ['Часы кампаний не превышают доступные',r.capacities.every(c=>c.used<=c.available+tol)],
 ['Раскрой не превышает ширину полотна',r.cuts.every(c=>c.used<=c.deckle)],
 ['Баланс массы: годный выпуск + обрезь + брак',Math.abs(sum(r.cuts,c=>c.good+c.gross*c.trim+c.qualityLoss)-r.total.gross)<tol],
 ['Сырьё и энергия в пределах лимита',r.resources.every(x=>x.used<=x.available+tol)],
 ['Отгрузки не превышают спрос',r.rows.every(x=>x.sales<=x.demand+tol)],
 ['Клиентские отгрузки сходятся с итогом',Math.abs(sum(r.customerRows,'sales')-r.total.sales)<tol],
 ['Финансовый баланс',r.rows.every(x=>Math.abs(x.revenue-x.variable-x.logistics-x.holding-x.margin)<tol)],
 ['Баланс сети за год',Math.abs(r.total.initial+r.total.production-r.total.sales-r.total.end)<tol],
 ['Ёмкости складов',nodes.every(n=>months.every((_,m)=>sum(r.ledgers.filter(l=>l.node===n.id&&l.month===m),'end')<=n.cap+tol))]
 ].map(([name,ok])=>({name,ok}));}
const api={months,products,skus,nodes,clients,segments,scenarios,sum,demand,patterns,run,validate};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.KamaModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
