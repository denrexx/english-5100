'use strict';
const $ = s => document.querySelector(s);
const main = $('#main');
const STORE = 'lexi.v1';
const LEVEL_LAYOUT = 'thousand-v1';
const AUTOPLAY_DEFAULTS = 2;
function levelRanges(){return [0,1000,2000,3000,4000].filter(from=>from<data.words.length).map((from,i)=>({first:from+1,last:i===4?data.words.length:Math.min(from+1000,data.words.length)}));}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const initialState = () => ({version:1, levelLayout:LEVEL_LAYOUT, autoplayDefaults:AUTOPLAY_DEFAULTS, mistakes:{}, unknown:[], known:[], levels:{}, history:[], days:{}, answers:0, correct:0, session:null, settings:{sound:true, autoplay:true, theme:'light'}});
let state = initialState(), data, byId, session = null, timerHandle, toastHandle, audio = new Audio(), wordTab = 'unknown', wordSearch = '', visibleWords = 60, storageAvailable = true;
let clock = {base:0,last:0,running:false,manual:false};
let voiceJob=0;
let motionObserver=null;
function stopVoice(){voiceJob++;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();if('speechSynthesis' in window)speechSynthesis.cancel();}
try {const raw = localStorage.getItem(STORE); if(raw) state = normalizeState(JSON.parse(raw));} catch {storageAvailable = false;}
document.documentElement.dataset.theme = state.settings.theme;
function normalizeState(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.unknown) || !Array.isArray(raw.known) || !Array.isArray(raw.history) || typeof raw.mistakes !== 'object' || !raw.mistakes || typeof raw.levels !== 'object' || !raw.levels || typeof raw.days !== 'object' || !raw.days) throw Error('Некорректный файл прогресса');
  const uniqueIds = a => [...new Set(a.filter(id => typeof id === 'string' && id.length < 200))];
  const cleanMap = m => Object.fromEntries(Object.entries(m).filter(([k,v]) => k.length < 200 && Number.isFinite(v) && v >= 0));
  const s = initialState();
  s.unknown = uniqueIds(raw.unknown); s.known = uniqueIds(raw.known); s.mistakes = cleanMap(raw.mistakes); s.levels = cleanMap(raw.levels); s.days = cleanMap(raw.days);
  s.history = raw.history.filter(h => h && typeof h.title === 'string' && typeof h.date === 'string' && ['elapsed','total','correct','errors','unknown'].every(k => Number.isFinite(h[k]) && h[k]>=0)).slice(0,100);
  s.answers = Number.isFinite(raw.answers) && raw.answers >= 0 ? raw.answers : 0; s.correct = Number.isFinite(raw.correct) && raw.correct >= 0 ? Math.min(raw.correct,s.answers) : 0;
  s.settings = {sound:raw.settings?.sound !== false,autoplay:raw.autoplayDefaults === AUTOPLAY_DEFAULTS ? raw.settings?.autoplay !== false : true,theme:raw.settings?.theme === 'dark' ? 'dark' : 'light'};
  const a=raw.session;
  if(a && ['level','test','custom','mistakes','unknowns','phrasal'].includes(a.mode) && typeof a.title === 'string' && ['en_ru','ru_en'].includes(a.direction) && Array.isArray(a.queue) && a.queue.length > 0 && a.queue.length <= 12000 && a.queue.every(id=>typeof id==='string') && Number.isInteger(a.position) && a.position>=0 && a.position<a.queue.length && ['correct','errors','unknown','elapsed'].every(k=>Number.isFinite(a[k])&&a[k]>=0)) {
    s.session={mode:a.mode,title:a.title.slice(0,100),direction:a.direction,queue:a.queue,position:a.position,correct:a.correct,errors:a.errors,unknown:a.unknown,elapsed:a.elapsed,level:Number.isInteger(a.level)?a.level:null,roundSize:Number.isInteger(a.roundSize)?a.roundSize:0,options:Array.isArray(a.options)&&a.options.every(o=>typeof o==='string')?a.options.slice(0,3):[],feedback:a.feedback && typeof a.feedback.answer==='string'?{answer:a.feedback.answer,selected:String(a.feedback.selected||''),ok:!!a.feedback.ok}:null};
  }
  if(raw.levelLayout !== LEVEL_LAYOUT){
    const previous=s.levels;
    s.levels={};
    [[0,1],[2,3],[4,5],[6,7],[8,9,10]].forEach((group,index)=>{
      if(group.every(key=>Object.hasOwn(previous,key)))s.levels[index]=group.reduce((sum,key)=>sum+previous[key],0);
    });
    if(s.session?.mode==='level'){
      const old=s.session;
      old.mode='custom';old.level=null;
      old.title=`Слова ${Number.isInteger(a.level)?a.level*500+1:1}–${Number.isInteger(a.level)?Math.min((a.level+1)*500,5100):old.queue.length} · прежний уровень`;
    }
  }
  return s;
}
function save() {
  if(session) {session.elapsed=clock.base;state.session=session;}
  try {localStorage.setItem(STORE,JSON.stringify(state));} catch {if(storageAvailable) toast('Браузер не сохранил прогресс. Сделайте резервную копию в настройках');storageAvailable=false;}
}
function esc(v) {return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(n) {return new Intl.NumberFormat('ru-RU').format(n);}
function time(ms) {const n=Math.floor(ms/1000),h=Math.floor(n/3600),m=Math.floor(n/60)%60,s=n%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
function dayKey() {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function shuffle(a) {const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastHandle);toastHandle=setTimeout(()=>$('#toast').classList.remove('visible'),2800);}
function enter(el=main) {
  if(!el||reducedMotion.matches)return;
  el.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:340,easing:'cubic-bezier(.23,1,.32,1)'});
  const cards=el.querySelectorAll('.level-card,.mode-card,.stat-card,.answer,.word-row');
  cards.forEach((card,i)=>card.animate([{opacity:0,transform:'translateY(16px) scale(.985)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:390,delay:Math.min(i*32,180),easing:'cubic-bezier(.23,1,.32,1)',fill:'backwards'}));
  const orb=el.querySelector('.result-orb');
  if(orb)orb.animate([{transform:'rotate(-16deg) scale(.72)',opacity:0},{transform:'rotate(-5deg) scale(1.035)',opacity:1,offset:.72},{transform:'rotate(-8deg) scale(1)',opacity:1}],{duration:650,easing:'cubic-bezier(.2,.8,.2,1)'});
  const rejected=el.querySelector('.answer.bad');
  if(rejected)rejected.animate([{transform:'translateX(0)'},{transform:'translateX(-4px)'},{transform:'translateX(4px)'},{transform:'translateX(0)'}],{duration:240});
}
function observeMotion(){
  motionObserver?.disconnect();
  const art=$('.hero-art');
  if(!art||reducedMotion.matches)return;
  motionObserver=new IntersectionObserver(entries=>art.classList.toggle('motion-visible',entries[0].isIntersecting),{threshold:.15});
  motionObserver.observe(art);
}
function modal(title,content) {$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=content;if(!$('#dialog').open)$('#dialog').showModal();enter($('#dialog'));}
function closeModal() {$('#dialog').close();}
function updateHeader(route) {document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active',a.hash===`#${route}`));const total=new Set([...state.unknown,...Object.keys(state.mistakes)]).size;$('#words-count').textContent=total?`· ${total}`:'';document.body.classList.toggle('session-active',!!session);}
function activeElapsed(now=performance.now()) {return clock.base+(clock.running&&now-clock.last<10000?Math.max(0,now-clock.last):0);}
function touchClock() {
  if(!session||clock.manual)return;
  const now=performance.now();
  if(clock.running && now-clock.last<10000)clock.base+=Math.max(0,now-clock.last);
  clock.last=now;clock.running=true;updateTimer();scheduleTimer();
}
function scheduleTimer(){if(!timerHandle&&session&&!clock.manual)timerHandle=setInterval(updateTimer,250);}
function updateTimer() {
  if(!session)return;
  if(clock.running&&performance.now()-clock.last>=10000){clock.running=false;clearInterval(timerHandle);timerHandle=null;save();}
  const readout=$('#timer');if(readout)readout.textContent=time(activeElapsed());
  const label=$('#timer-label');if(label)label.textContent=clock.manual?'На паузе':clock.running?'Активное время':'Пауза · 10 с без действий';
  const pause=$('#pause');if(pause){pause.textContent=clock.manual?'▶':'Ⅱ';pause.setAttribute('aria-label',clock.manual?'Продолжить':'Приостановить');}
}
function stopClock() {const now=performance.now();if(clock.running&&now-clock.last<10000)clock.base+=Math.max(0,now-clock.last);clock.running=false;clearInterval(timerHandle);timerHandle=null;}
function suspendSession() {if(!session)return;stopClock();save();session=null;stopVoice();}
function nextLevel(){const total=levelRanges().length;for(let i=0;i<total;i++)if(!Object.hasOwn(state.levels,i))return i;return 0;}
function home() {
  updateHeader('learn');const level=nextLevel(),ranges=levelRanges(),count=ranges.length,saved=state.session;
  const firstCard=data.words.find(item=>item.word==='world')||{id:'words:world',word:'world',translation:'мир'};
  const secondCard=randomDemo([firstCard.id]);
  main.innerHTML=`${!storageAvailable?'<div class="storage-warning">Прогресс не сохраняется в этом браузере. Резервную копию можно скачать в настройках</div>':''}
  <section class="hero"><div class="hero-copy"><h1>Английский<br><span>5100 слов</span></h1><p>5100 самых частотных слов современного американского английского<br>Список составлен на основе более 20 миллионов субтитров с YouTube и TikTok</p><div class="hero-actions"><button class="button" data-action="${saved?'resume':'level'}" data-value="${level}">${saved?'Продолжить':'Начать учиться'}<span class="arrow">↗</span></button><button class="text-button" data-action="start" data-value="test">Проверить себя →</button></div></div>
  <div class="hero-art"><span class="art-spark" aria-hidden="true">✧</span><div class="card-stack" id="card-stack"><div class="stack-back" aria-hidden="true"></div><div class="stack-back second" aria-hidden="true"></div>${demoCard(secondCard,true)}${demoCard(firstCard)}</div></div></section>
  <div class="overview"><div class="overview-item"><strong>${num(data.words.length)}</strong><span>полезных слов</span></div><div class="overview-item"><strong>${count}</strong><span>уровней практики</span></div><div class="overview-item"><strong>${data.phrasal.length}</strong><span>фразовых глаголов</span></div><div class="overview-item"><strong>${num(state.known.length)}</strong><span>слов уже знакомо</span></div></div>
  <section aria-labelledby="levels-title"><div class="section-head"><div><h2 id="levels-title">Уровни</h2></div><span class="section-label">1000 слов · последний 1100</span></div><div class="levels">${Array.from({length:count},(_,i)=>{const {first,last}=ranges[i],done=Object.hasOwn(state.levels,i),resume=saved?.mode==='level'&&saved.level===i,progress=done?100:resume?Math.round(saved.position/saved.queue.length*100):0;return `<button class="level-card ${i===level?'featured':''}" data-action="level" data-value="${i}"><div class="level-top"><span class="level-no">${String(i+1).padStart(2,'0')} / УРОВЕНЬ</span><span class="level-arrow">${done?'✓':'↗'}</span></div><strong>Слова ${num(first)}–${num(last)}</strong><small>${done?`Пройден · ${time(state.levels[i])}`:resume?`В процессе · ${progress}%`:`${last-first+1} слов`}</small><div class="mini-track"><i style="transform:scaleX(${progress/100})"></i></div></button>`;}).join('')}<button class="level-card" data-action="custom"><div class="level-top"><span class="level-no">ДИАПАЗОН</span><span class="level-arrow">+</span></div><strong>Свой уровень</strong><small>Любой диапазон слов</small></button></div></section>
  <section aria-labelledby="practice-title"><div class="section-head"><div><h2 id="practice-title">Другие режимы</h2></div></div><div class="modes">${modeCard('test','◎','Проверить себя','50 вопросов из всего словаря')}${modeCard('mistakes','↺','Работа над ошибками',`${Object.keys(state.mistakes).length} слов для повторения`)}${modeCard('phrasal','↗','Фразовые глаголы',`${data.phrasal.length} фразовых глаголов`)}${modeCard('unknowns','◇','Пока не знаю',`${state.unknown.length} слов в вашей коллекции`)}</div></section>`;
  attachTilt();observeMotion();enter();
}
function randomDemo(excluded=[]){
  let item;
  do{item=data.words[Math.floor(Math.random()*data.words.length)];}while(excluded.includes(item.id)&&data.words.length>excluded.length);
  return item;
}
function demoCard(item,preview=false){
  const size=Math.max(1.15,Math.min(3,24/item.word.length));
  return `<button type="button" class="demo-card ${preview?'preview':'front'}" data-id="${esc(item.id)}" data-action="demo-next" style="--demo-word-size:${size}rem" ${preview?'disabled tabindex="-1" aria-hidden="true"':`aria-label="Следующее слово, ${esc(item.word)}: ${esc(item.translation)}"`}><span class="demo-top"><span>EN</span></span><span><span class="demo-word" lang="en">${esc(item.word)}</span><span class="demo-translation">${esc(item.translation)}</span></span><span class="demo-bottom"><span aria-hidden="true">←</span></span></button>`;
}
function nextDemo(){
  const stack=$('#card-stack'),current=stack?.querySelector('.front'),next=stack?.querySelector('.preview');
  if(!current||!next)return;
  const restoreFocus=document.activeElement===current;
  const from=getComputedStyle(current).transform;
  const nextFrom=getComputedStyle(next).transform;
  current.classList.replace('front','departing');current.disabled=true;current.setAttribute('aria-hidden','true');current.tabIndex=-1;
  next.classList.replace('preview','front');next.disabled=false;next.removeAttribute('aria-hidden');next.removeAttribute('tabindex');
  const item=byId.get(next.dataset.id);
  next.setAttribute('aria-label',`Следующее слово, ${item.word}: ${item.translation}`);
  stack.insertAdjacentHTML('afterbegin',demoCard(randomDemo([current.dataset.id,next.dataset.id]),true));
  if(restoreFocus)next.focus({preventScroll:true});
  if(reducedMotion.matches){current.remove();return;}
  const distance=Math.max(350,stack.getBoundingClientRect().width*1.3);
  const outgoing=current.animate([{transform:from,opacity:1},{transform:`translateX(${-distance}px) translateY(-18px) rotate(-22deg)`,opacity:0}],{duration:420,easing:'cubic-bezier(.32,.72,0,1)',fill:'forwards'});
  outgoing.finished.then(()=>current.remove()).catch(()=>current.remove());
  next.animate([{transform:nextFrom},{transform:'translate(0,0) rotate(0) scale(1)'}],{duration:430,easing:'cubic-bezier(.23,1,.32,1)'});
}
function modeCard(mode,icon,title,description){return `<button class="mode-card" data-action="start" data-value="${mode}"><span class="mode-icon">${icon}</span><span><strong>${title}</strong><small>${description}</small></span><span class="arrow">↗</span></button>`;}
function attachTilt(){const stack=$('#card-stack'),area=$('.hero-art');if(!stack||reducedMotion.matches||!matchMedia('(hover: hover) and (pointer: fine)').matches)return;let x=0,y=0,vx=0,vy=0,tx=0,ty=0,frame=0,last=0;const step=now=>{const dt=Math.min((now-last)/1000||.016,.032);last=now;vx+=(190*(tx-x)-27*vx)*dt;vy+=(190*(ty-y)-27*vy)*dt;x+=vx*dt;y+=vy*dt;stack.style.transform=`rotate(-8deg) rotateX(${x}deg) rotateY(${-9+y}deg)`;if(Math.abs(tx-x)+Math.abs(ty-y)+Math.abs(vx)+Math.abs(vy)>.05)frame=requestAnimationFrame(step);else frame=0;};const start=()=>{if(!frame){last=performance.now();frame=requestAnimationFrame(step);}};area.addEventListener('pointermove',e=>{const r=area.getBoundingClientRect();tx=-(e.clientY-r.top-r.height/2)/r.height*10;ty=(e.clientX-r.left-r.width/2)/r.width*12;start();});area.addEventListener('pointerleave',()=>{tx=ty=0;start();});}
function choose(mode,level=null,range=null){
  if(mode==='level' && state.session?.mode==='level' && state.session.level===level){resume();return;}
  if(mode==='mistakes'&&!Object.keys(state.mistakes).length){toast('Ошибок пока нет. Можно начать с любого уровня');return;}
  if(mode==='unknowns'&&!state.unknown.length){toast('Здесь появятся слова, которые вы отметите «Не знаю»');return;}
  modal('В какую сторону?',`<p class="dialog-copy">${mode==='level'?`Уровень ${level+1}: `:''}Выберите, с какого языка переводить${state.session?'<br>Текущая незаконченная тренировка будет заменена':''}</p><div class="direction-options"><button class="button" id="en-ru">Английский <span>→</span> Русский</button><button class="button secondary" id="ru-en">Русский <span>→</span> Английский</button></div>`);
  $('#en-ru').onclick=()=>begin(mode,level,range,'en_ru');$('#ru-en').onclick=()=>begin(mode,level,range,'ru_en');
}
function begin(mode,level,range,direction){
  let queue=[],title='',roundSize=0;
  if(mode==='level'){const r=levelRanges()[level];if(!r)return;queue=data.words.slice(r.first-1,r.last);title=`Уровень ${level+1}`;}
  if(mode==='test'){queue=Array.from({length:50},(_,i)=>{const from=Math.floor(i*data.words.length/50),to=Math.floor((i+1)*data.words.length/50);return data.words[from+Math.floor(Math.random()*(to-from))];});title='Тест словарного запаса';}
  if(mode==='custom'){queue=data.words.slice(range[0]-1,range[1]);title=`Слова ${range[0]}–${range[1]}`;}
  if(mode==='phrasal'){queue=data.phrasal;title='Фразовые глаголы';}
  if(mode==='mistakes'){const ids=shuffle(Object.keys(state.mistakes)).filter(id=>byId.has(id));roundSize=ids.length;queue=[...ids,...ids].map(id=>byId.get(id));title='Работа над ошибками';}
  if(mode==='unknowns'){queue=state.unknown.filter(id=>byId.has(id)).map(id=>byId.get(id));title='Пока не знаю';}
  if(!queue.length){closeModal();toast('В этой коллекции пока нет слов');return;}
  suspendSession();closeModal();session={mode,level,title,direction,queue:queue.map(w=>w.id),position:0,correct:0,errors:0,unknown:0,elapsed:0,options:[],feedback:null,roundSize};
  clock={base:0,last:performance.now(),running:true,manual:false};state.session=session;save();if(location.hash==='#session')exercise();else location.hash='session';scheduleTimer();
}
function resume(){if(!state.session)return;session=state.session;clock={base:session.elapsed,last:performance.now(),running:true,manual:false};if(location.hash==='#session')exercise();else location.hash='session';scheduleTimer();}
function optionsFor(item){const key=session.direction==='en_ru'?'translation':'word',correct=item[key],pool=item.id.startsWith('phrasal:')?data.phrasal:data.words;const index=pool.indexOf(item);let candidates=[...new Set(pool.slice(Math.max(0,index-40),index+41).map(w=>w[key]))].filter(w=>w!==correct);if(candidates.length<2)candidates=[...new Set([...data.words,...data.phrasal].map(w=>w[key]))].filter(w=>w!==correct);return shuffle([...shuffle(candidates).slice(0,2),correct]);}
function exercise(){
  if(!session){home();return;}
  updateHeader('');const item=byId.get(session.queue[session.position]);if(!item){suspendSession();state.session=null;save();location.hash='learn';toast('Словарь изменился. Начните новую тренировку');return;}
  if(session.options.length!==3){session.options=optionsFor(item);save();}
  const feedback=session.feedback,question=session.direction==='en_ru'?item.word:item.translation,answer=session.direction==='en_ru'?item.translation:item.word;
  main.innerHTML=`<section class="session-head"><div class="session-title"><button class="icon-button" data-action="home" aria-label="Вернуться к обучению">←</button><div><h3>${esc(session.title)}</h3><small>${session.direction==='en_ru'?'Английский → Русский':'Русский → Английский'}</small></div></div><div class="timer-box"><div><div class="timer-readout" id="timer">${time(activeElapsed())}</div><div class="timer-label" id="timer-label">Активное время</div></div><button class="icon-button" data-action="pause" id="pause" aria-label="Приостановить">Ⅱ</button></div></section><div class="session-progress"><div class="progress-track" role="progressbar" aria-label="Прогресс тренировки" aria-valuemin="0" aria-valuemax="${session.queue.length}" aria-valuenow="${session.position}"><i style="transform:scaleX(${session.position/session.queue.length})"></i></div><span>${session.position+1} / ${session.queue.length}</span></div>
  <div class="exercise" id="exercise-content">${clock.manual?pausedHtml():`<div class="question-card"><div class="question-top"><span>СЛОВО ${item.number} <span aria-hidden="true">·</span> ${item.id.startsWith('phrasal:')?'ВЫРАЖЕНИЕ':'ПРАКТИКА'}</span><button class="icon-button" data-action="speak" aria-label="Послушать произношение">${speakerIcon()}</button></div><h1 class="question-word" lang="${session.direction==='en_ru'?'en':'ru'}">${esc(question)}</h1><p class="question-hint">${session.direction==='en_ru'?'Выберите перевод на русский':'Выберите перевод на английский'}</p></div><div class="answers">${session.options.map((o,i)=>`<button class="answer ${feedback?(o===answer?'good':o===feedback.selected?'bad':''):''}" data-action="answer" data-value="${i}" ${feedback?'disabled':''}><span class="answer-key" aria-hidden="true">${i+1}</span><span class="answer-text" lang="${session.direction==='en_ru'?'ru':'en'}">${esc(o)}</span>${feedback&&o===answer?'<span class="answer-mark">✓</span>':''}</button>`).join('')}</div><p class="feedback-line" role="status">${feedback?`Правильный ответ: ${esc(answer)}`:' '}</p><div class="exercise-bottom"><button class="button unknown-button" data-action="unknown" aria-keyshortcuts="4" ${feedback?'disabled':''}><span class="shortcut-key" aria-hidden="true">4</span>${session.mode==='unknowns'?'Уже знаю ✓':'Не знаю'}</button>${feedback?'<button class="button" data-action="next">Дальше <span>→</span></button>':`<span class="section-label">${session.correct} верно · ${session.errors} ошибок</span>`}</div><p class="keyboard-hint">1, 2, 3: ответ &nbsp; · &nbsp; 4: не знаю &nbsp; · &nbsp; Space: произношение &nbsp; · &nbsp; P: пауза</p>`}</div><p class="session-note">Пауза после 10 секунд без нажатий<br>Время ожидания исключается из результата</p>`;
  updateTimer();if(!clock.manual){enter($('#exercise-content'));if(state.settings.autoplay&&!feedback)speak(item,true);}
}
function pausedHtml(){return `<div class="pause-cover"><div class="empty-symbol">Ⅱ</div><h2>Пауза</h2><p>Время не идёт</p><button class="button" data-action="pause">Продолжить <span>→</span></button></div>`;}
function speakerIcon(){return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></svg>';}
function answerQuestion(i){
  if(!session||session.feedback||clock.manual)return;const item=byId.get(session.queue[session.position]),correct=session.direction==='en_ru'?item.translation:item.word,selected=session.options[i];if(selected===undefined)return;
  touchClock();state.answers++;state.days[dayKey()]=(state.days[dayKey()]||0)+1;
  if(selected===correct){session.correct++;state.correct++;if(!state.known.includes(item.id))state.known.push(item.id);if(session.mode==='mistakes'&&session.position>=session.roundSize)delete state.mistakes[item.id];save();advance();toast('Верно ✓');}
  else{session.errors++;state.mistakes[item.id]=(state.mistakes[item.id]||0)+1;state.known=state.known.filter(id=>id!==item.id);session.feedback={answer:correct,selected,ok:false};save();exercise();}
}
function unknownQuestion(){if(!session||session.feedback||clock.manual)return;touchClock();const id=session.queue[session.position];if(session.mode==='unknowns'){state.unknown=state.unknown.filter(w=>w!==id);if(!state.known.includes(id))state.known.push(id);session.correct++;}else{if(!state.unknown.includes(id))state.unknown.push(id);session.unknown++;state.known=state.known.filter(w=>w!==id);}state.answers++;state.days[dayKey()]=(state.days[dayKey()]||0)+1;save();advance();}
function advance(){session.position++;session.options=[];session.feedback=null;if(session.position>=session.queue.length)finish();else{save();exercise();}}
function finish(){
  stopClock();const result={mode:session.mode,level:session.level,title:session.title,elapsed:clock.base,total:session.queue.length,correct:session.correct,errors:session.errors,unknown:session.unknown,date:new Date().toISOString()};
  if(session.mode==='level')state.levels[session.level]=result.elapsed;state.history.unshift(result);state.history=state.history.slice(0,100);state.session=null;session=null;save();stopVoice();updateHeader('progress');renderResult(result);
}
function renderResult(r){main.innerHTML=`<section class="result"><div class="result-orb" aria-hidden="true">✓</div><div class="eyebrow" style="justify-content:center;margin-bottom:12px">${esc(r.title)} · завершено</div><h1>Тренировка завершена</h1><p>${r.mode==='test'?`Ориентировочно знакомы ${num(Math.round(r.correct/r.total*data.words.length))} слов из ${num(data.words.length)}. Это приблизительная оценка`:''}</p><div class="result-time">${time(r.elapsed)}</div><div class="result-time-label">активного времени · без пауз и ожидания</div><div class="stats-grid"><div class="stat-card"><small>Правильных ответов</small><strong>${r.correct}</strong></div><div class="stat-card"><small>Ошибок</small><strong>${r.errors}</strong></div><div class="stat-card"><small>Пока не знаю</small><strong>${r.unknown}</strong></div></div><div class="result-actions">${r.mode==='level'&&r.level+1<levelRanges().length?`<button class="button" data-action="level" data-value="${r.level+1}">Следующий уровень ↗</button>`:'<button class="button" data-action="home">К обучению ↗</button>'}<button class="button secondary" data-action="route" data-value="progress">Посмотреть прогресс</button></div></section>`;enter();}
function togglePause(){if(!session)return;if(clock.manual){clock.manual=false;touchClock();}else{stopClock();clock.manual=true;stopVoice();}save();exercise();}
function speak(item,auto=false){
  if(!state.settings.sound){if(!auto)toast('Включите произношение в настройках');return;}
  if(!item)return;stopVoice();const job=voiceJob;audio.preload='none';audio.src=`audio/${item.audio}.ogg`;audio.onerror=()=>{if(job===voiceJob)speechFallback(item,auto);};audio.play().catch(e=>{if(job!==voiceJob)return;if(e.name==='NotAllowedError'){if(!auto)toast('Нажмите на значок звука, чтобы разрешить воспроизведение');}else if(e.name!=='AbortError')speechFallback(item,auto);});
}
function speechFallback(item,auto){if(!('speechSynthesis' in window)){if(!auto)toast('Произношение сейчас недоступно');return;}const voices=speechSynthesis.getVoices(),voice=voices.find(v=>v.lang==='en-US')||voices.find(v=>v.lang.startsWith('en'));if(!voice){if(!auto)toast('Для этого слова нет записи; английский голос браузера недоступен');return;}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(item.word);u.lang='en-US';u.voice=voice;u.rate=.9;speechSynthesis.speak(u);}
function customDialog(){modal('Ваш диапазон',`<p class="dialog-copy">Можно пройти 10 слов или целую тысячу. Выберите диапазон от 1 до ${num(data.words.length)}</p><form id="range-form"><div class="range-fields"><label>Первое слово<input id="range-first" type="number" min="1" max="${data.words.length}" value="1" required></label><label>Последнее слово<input id="range-last" type="number" min="1" max="${data.words.length}" value="10" required></label></div><p class="field-error" id="range-error" role="alert"></p><button class="button" type="submit" style="width:100%">Выбрать направление →</button></form>`);$('#range-form').onsubmit=e=>{e.preventDefault();const a=Number($('#range-first').value),b=Number($('#range-last').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>data.words.length){$('#range-error').textContent='Укажите правильный диапазон: первое слово ≤ последнего';return;}choose('custom',null,[a,b]);};}
function wordsPage(){
  updateHeader('words');const ids=wordTab==='mistakes'?Object.keys(state.mistakes):wordTab==='all'?[...new Set([...state.unknown,...Object.keys(state.mistakes)])]:state.unknown;const list=ids.map(id=>byId.get(id)).filter(Boolean).filter(w=>`${w.word} ${w.translation}`.toLocaleLowerCase().includes(wordSearch.toLocaleLowerCase()));
  main.innerHTML=`<div class="page-head"><h1>Мои слова</h1></div><div class="toolbar"><div class="segmented">${[['unknown','Пока не знаю'],['mistakes','Ошибки'],['all','Всё сложное']].map(([v,t])=>`<button data-action="word-tab" data-value="${v}" class="${wordTab===v?'selected':''}">${t}</button>`).join('')}</div><input class="search" id="word-search" type="search" placeholder="Найти слово…" aria-label="Поиск по коллекции" value="${esc(wordSearch)}"><button class="button secondary" data-action="export-txt">Скачать TXT ↓</button></div><div id="collection-body">${collectionHtml(list)}</div>`;$('#word-search').addEventListener('input',e=>{wordSearch=e.target.value;visibleWords=60;const filtered=ids.map(id=>byId.get(id)).filter(Boolean).filter(w=>`${w.word} ${w.translation}`.toLocaleLowerCase().includes(wordSearch.toLocaleLowerCase()));$('#collection-body').innerHTML=collectionHtml(filtered);});enter();
}
function collectionHtml(list){if(!list.length)return `<div class="empty"><div class="empty-symbol">◇</div><h2>${wordSearch?'Ничего не нашлось':'Список пуст'}</h2><p>${wordSearch?'Попробуйте другое слово или перевод':'Здесь появятся слова, отмеченные «Не знаю»'}</p><button class="button" data-action="home">К обучению ↗</button></div>`;return `<div class="section-head"><span class="section-label">${num(list.length)} слов</span><button class="text-button" data-action="start" data-value="${wordTab==='mistakes'?'mistakes':'unknowns'}">${wordTab==='all'?'Повторить «Пока не знаю»':'Повторить коллекцию'} →</button></div><div class="word-list">${list.slice(0,visibleWords).map(w=>`<div class="word-row"><span class="word-text"><strong lang="en">${esc(w.word)}</strong><small>${esc(w.translation)}</small></span><button class="icon-button" data-action="speak-id" data-id="${esc(w.id)}" aria-label="Произношение: ${esc(w.word)}">${speakerIcon()}</button><button class="icon-button delete-button" data-action="remove-word" data-id="${esc(w.id)}" aria-label="Убрать ${esc(w.word)} из коллекции">×</button></div>`).join('')}</div>${list.length>visibleWords?'<button class="button secondary more-button" data-action="more-words">Показать ещё</button>':''}`;}
function progressPage(){updateHeader('progress');const totalTime=state.history.reduce((a,h)=>a+h.elapsed,0);main.innerHTML=`<div class="page-head"><h1>Прогресс</h1></div><div class="stats-grid"><div class="stat-card"><small>Знакомых слов</small><strong>${num(state.known.length)}</strong></div><div class="stat-card"><small>Правильных ответов</small><strong>${state.answers?Math.round(state.correct/state.answers*100):0}%</strong></div><div class="stat-card"><small>Сегодня ответов</small><strong>${num(state.days[dayKey()]||0)}</strong></div><div class="stat-card"><small>Время завершённых занятий</small><strong>${time(totalTime)}</strong></div></div><div class="section-head"><h2>История практики</h2><span class="section-label">${state.history.length} занятий</span></div>${state.history.length?`<div class="history">${state.history.map(h=>`<div class="history-row"><span><strong>${esc(h.title)}</strong><small>${esc(new Date(h.date).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}))}</small></span><span><strong>${time(h.elapsed)}</strong><small>активного времени</small></span><span><strong>${h.correct} / ${h.total}</strong><small>верно · ${h.errors} ошибок</small></span></div>`).join('')}</div>`:'<div class="empty"><div class="empty-symbol">↗</div><h2>Нет завершённых тренировок</h2><p>Завершите тренировку, и здесь появится ваш результат</p><button class="button" data-action="home">Начать учиться ↗</button></div>'}`;enter();}
function settingsDialog(){modal('Настройки',`<p class="dialog-copy">Ваш прогресс хранится в этом браузере. Скачайте копию, чтобы перенести его на другое устройство</p><label class="form-row"><span>Произношение<small>Произношение английских слов</small></span><input id="sound-setting" type="checkbox" ${state.settings.sound?'checked':''}></label><label class="form-row"><span>Автоматическая озвучка<small>Читать слово при открытии карточки</small></span><input id="autoplay-setting" type="checkbox" ${state.settings.autoplay?'checked':''}></label><div class="form-row"><span>Пауза при бездействии<small>10 секунд ожидания исключаются из времени</small></span><span>10 с</span></div><div class="dialog-actions"><button class="button secondary" id="backup">Скачать копию прогресса ↓</button><button class="button quiet" id="restore">Восстановить из копии ↑</button><button class="text-button" id="export-range">Скачать диапазон слов в TXT</button><input id="restore-file" type="file" accept="application/json,.json" hidden></div><p class="dialog-copy" style="margin-top:18px;margin-bottom:0">Клавиши: 1, 2, 3: ответ; 4: не знаю; Space: звук; P: пауза. Интернет после первой загрузки не нужен для карточек</p>`);
  $('#sound-setting').onchange=e=>{state.settings.sound=e.target.checked;if(!e.target.checked){audio.pause();if('speechSynthesis' in window)speechSynthesis.cancel();}save();};$('#autoplay-setting').onchange=e=>{state.settings.autoplay=e.target.checked;save();};$('#backup').onclick=()=>{if(session)touchClock();save();download('lexi-progress.json',JSON.stringify(state,null,2),'application/json');};$('#restore').onclick=()=>$('#restore-file').click();$('#restore-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024){toast('Файл слишком большой. Выберите копию прогресса сайта');return;}try{const imported=normalizeState(JSON.parse(await f.text()));modal('Восстановить прогресс?',`<p class="dialog-copy">Копия содержит ${num(imported.known.length)} знакомых слов и ${imported.history.length} занятий. Она заменит прогресс в этом браузере</p><div class="dialog-actions"><button class="button" id="confirm-restore">Восстановить</button><button class="button secondary" id="cancel-restore">Отмена</button></div>`);$('#confirm-restore').onclick=()=>{suspendSession();state=imported;state.unknown=state.unknown.filter(id=>byId.has(id));state.known=state.known.filter(id=>byId.has(id));state.mistakes=Object.fromEntries(Object.entries(state.mistakes).filter(([id])=>byId.has(id)));if(state.session?.queue.some(id=>!byId.has(id)))state.session=null;save();document.documentElement.dataset.theme=state.settings.theme;closeModal();location.hash='learn';home();toast('Прогресс восстановлен');};$('#cancel-restore').onclick=settingsDialog;}catch{toast('Это не копия прогресса сайта или файл повреждён');}};$('#export-range').onclick=exportRangeDialog;
}
function download(name,content,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportTxt(items,name){if(!items.length){toast('В выбранной коллекции пока нет слов');return;}download(name,'\ufeff'+items.map((w,i)=>`${i+1}. ${w.word} - ${w.translation}`).join('\n')+'\n');}
function exportRangeDialog(){modal('Скачать слова',`<p class="dialog-copy">Сохраните нужный диапазон в текстовый файл</p><form id="export-form"><div class="range-fields"><label>От<input id="export-first" type="number" min="1" max="${data.words.length}" value="1" required></label><label>До<input id="export-last" type="number" min="1" max="${data.words.length}" value="${data.words.length}" required></label></div><p class="field-error" id="export-error" role="alert"></p><button class="button" type="submit" style="width:100%">Скачать TXT ↓</button></form>`);$('#export-form').onsubmit=e=>{e.preventDefault();const a=Number($('#export-first').value),b=Number($('#export-last').value);if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>data.words.length){$('#export-error').textContent='Укажите правильный диапазон';return;}exportTxt(data.words.slice(a-1,b),`lexi-words-${a}-${b}.txt`);};}
function route(){if(!data)return;motionObserver?.disconnect();window.scrollTo({top:0,behavior:'instant'});const hash=location.hash.slice(1)||'learn';if(hash==='session'&&session){exercise();return;}if(hash==='session'&&state.session){resume();return;}suspendSession();if(hash==='words')wordsPage();else if(hash==='progress')progressPage();else home();}
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(button&&session&&button.dataset.action!=='pause')touchClock();
  const el=e.target.closest('[data-action]');if(el?.dataset.action==='retry'){location.reload();return;}if(!el||el.disabled||!data)return;
  const action=el.dataset.action,value=el.dataset.value;
  if(action==='demo-next')nextDemo();
  if(action==='level')choose('level',Number(value));if(action==='start')choose(value);if(action==='custom')customDialog();if(action==='resume')resume();
  if(action==='answer')answerQuestion(Number(value));if(action==='next'&&session?.feedback)advance();if(action==='unknown')unknownQuestion();if(action==='pause')togglePause();
  if(action==='speak')speak(byId.get(session?.queue[session?.position]));if(action==='speak-id')speak(byId.get(el.dataset.id));
  if(action==='home'){if(location.hash==='#learn'){suspendSession();home();}else location.hash='learn';}
  if(action==='route'){if(location.hash===`#${value}`){suspendSession();route();}else location.hash=value;}
  if(action==='word-tab'){wordTab=value;visibleWords=60;wordsPage();}if(action==='more-words'){visibleWords+=60;wordsPage();}
  if(action==='remove-word'){const id=el.dataset.id;if(wordTab!=='mistakes')state.unknown=state.unknown.filter(w=>w!==id);if(wordTab!=='unknown')delete state.mistakes[id];save();wordsPage();toast('Слово убрано из коллекции');}
  if(action==='export-txt'){const ids=wordTab==='mistakes'?Object.keys(state.mistakes):wordTab==='all'?[...new Set([...state.unknown,...Object.keys(state.mistakes)])]:state.unknown;exportTxt(ids.map(id=>byId.get(id)).filter(Boolean),`lexi-${wordTab}.txt`);}
});
$('#theme').onclick=()=>{state.settings.theme=state.settings.theme==='light'?'dark':'light';document.documentElement.dataset.theme=state.settings.theme;save();};
$('#settings').onclick=()=>{if(data)settingsDialog();};$('#close-dialog').onclick=closeModal;$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
window.addEventListener('hashchange',route);
document.addEventListener('keydown',e=>{if(!session||$('#dialog').open||e.ctrlKey||e.metaKey||e.altKey||e.repeat||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(/^[123]$/.test(e.key)){e.preventDefault();answerQuestion(Number(e.key)-1);}if(e.code==='Digit4'||e.code==='Numpad4'||e.key==='4'){e.preventDefault();unknownQuestion();}if(e.code==='Space'){e.preventDefault();touchClock();speak(byId.get(session.queue[session.position]));}if(e.code==='KeyP'||e.key.toLowerCase()==='p'){e.preventDefault();togglePause();}if(e.key==='Enter'&&session.feedback&&e.target===document.body){e.preventDefault();touchClock();advance();}});
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('tab-hidden',document.hidden);if(document.hidden){stopClock();save();stopVoice();}else updateTimer();});
window.addEventListener('pagehide',()=>{stopClock();save();});
async function init(){try{const response=await fetch('data.json');if(!response.ok)throw Error('dictionary');data=await response.json();byId=new Map([...data.words,...data.phrasal].map(w=>[w.id,w]));state.unknown=state.unknown.filter(id=>byId.has(id));state.known=state.known.filter(id=>byId.has(id));state.mistakes=Object.fromEntries(Object.entries(state.mistakes).filter(([id])=>byId.has(id)));if(state.session?.queue.some(id=>!byId.has(id)))state.session=null;save();route();if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});}catch{main.innerHTML='<div class="empty"><h2>Словарь пока не загрузился</h2><p>Запустите сайт через start.sh и откройте http://localhost:8080</p><button class="button" data-action="retry">Попробовать снова ↺</button></div>';}}
init();
