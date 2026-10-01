'use strict';
const progressSync = {
  key:'lexi.shared.v1', previous:'lexi.previous-progress', unsynced:'lexi.unsynced-progress',
  enabled:false, revision:0, pending:null, busy:false, timer:null, last:null, warned:false,
  metadata(){try{return JSON.parse(localStorage.getItem(this.key));}catch{return null;}},
  remember(dirty=!!this.pending){try{localStorage.setItem(this.key,JSON.stringify({revision:this.revision,dirty}));}catch{}},
  backup(value,key=this.unsynced){try{localStorage.setItem(key,JSON.stringify(value));}catch{}},
  backupData(){try{return localStorage.getItem(this.unsynced)||localStorage.getItem(this.previous);}catch{return null;}},
  hasProgress(value){return !!(value.answers||value.history.length||value.known.length||value.unknown.length||Object.keys(value.mistakes).length||value.session);},
  mergePrevious(remote,local){
    const merged=normalizeState(local.answers>remote.answers?local:remote);
    for(const key of ['known','unknown'])merged[key]=[...new Set([...remote[key],...local[key]])];
    for(const key of ['mistakes','levels','days']){
      merged[key]={...remote[key]};
      for(const [id,value] of Object.entries(local[key]))merged[key][id]=Math.max(merged[key][id]||0,value);
    }
    merged.answers=Math.max(remote.answers,local.answers);merged.correct=Math.max(remote.correct,local.correct);
    const history=new Map();
    for(const entry of [...remote.history,...local.history])history.set(`${entry.date}|${entry.title}|${entry.elapsed}|${entry.total}`,entry);
    merged.history=[...history.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
    return merged;
  },
  async request(query='',options={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4000);
    try{return await fetch(`api/progress${query}`,{cache:'no-store',...options,signal:controller.signal});}
    finally{clearTimeout(timeout);}
  },
  adopt(document,redraw=true){
    const active=!!session;
    clearInterval(timerHandle);timerHandle=null;stopVoice();session=null;
    state=normalizeState(document.state);this.revision=document.revision;this.last=JSON.stringify(state);
    clock={base:state.session?.elapsed||0,last:performance.now(),running:false,manual:false};
    try{localStorage.setItem(STORE,this.last);}catch{}
    this.remember(false);documentTheme();
    if(!redraw||!data)return;
    const hash=location.hash.slice(1)||'learn';
    if(hash==='session'&&state.session&&active){session=state.session;exercise();}
    else if(hash==='words')wordsPage();
    else if(hash==='progress')progressPage();
    else{home();if(hash==='session')location.hash='learn';}
  },
  queue(){
    if(!this.enabled)return;
    const body=JSON.stringify(state);
    if(body===this.last&&!this.pending&&!this.busy)return;
    this.pending=body;this.remember(true);clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.flush(),100);
  },
  async connect(){
    const metadata=this.metadata();
    try{
      const response=await this.request();
      if(response.status===404||response.status===405){this.enabled=false;return;}
      if(!response.ok)throw Error('progress');
      const document=await response.json();this.enabled=true;this.revision=document.revision;
      if(!document.state){this.queue();await this.flush();return;}
      if(!metadata&&this.hasProgress(state)){
        this.backup(state,this.previous);state=this.mergePrevious(normalizeState(document.state),state);
        this.queue();await this.flush();
      }else if(metadata?.dirty&&metadata.revision===document.revision){
        this.queue();await this.flush();
      }else{
        if(metadata?.dirty)this.backup(state);
        this.adopt(document,false);
      }
      this.remember();
    }catch{
      if(metadata){this.enabled=true;this.revision=metadata.revision;this.pending=JSON.stringify(state);this.remember(true);}
      setTimeout(()=>this.enabled?this.flush():this.connect(),3000);
    }
  },
  async flush(){
    if(!this.enabled||this.busy||!this.pending)return;
    clearTimeout(this.timer);this.busy=true;
    const body=this.pending;this.pending=null;let delay=100;
    try{
      const payload=JSON.stringify({revision:this.revision,state:JSON.parse(body)});
      const response=await this.request('',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:new TextEncoder().encode(payload).length<60000});
      if(response.status===409){
        this.backup(state);this.pending=null;this.adopt(await response.json());
        toast('Прогресс обновлён на другом устройстве');
      }else{
        if(!response.ok)throw Error('save');
        this.revision=(await response.json()).revision;this.last=body;this.warned=false;
        if(this.pending===body)this.pending=null;
      }
    }catch{
      if(!this.pending)this.pending=body;delay=3000;
      if(!this.warned){toast('Нет связи с сервером, прогресс сохранён на устройстве');this.warned=true;}
    }finally{
      this.busy=false;this.remember();
      if(this.pending)this.timer=setTimeout(()=>this.flush(),delay);
    }
  },
  async poll(){
    if(!this.enabled||this.busy||this.pending||document.hidden)return;
    this.busy=true;
    try{
      const response=await this.request(`?revision=${this.revision}`);
      if(response.status===204)return;
      if(response.ok){const value=await response.json();if(!this.pending&&value.state&&value.revision>this.revision)this.adopt(value);}
    }catch{}finally{this.busy=false;if(this.pending)this.timer=setTimeout(()=>this.flush(),100);}
  }
};
function documentTheme(){document.documentElement.dataset.theme=state.settings.theme;}
setInterval(()=>progressSync.poll(),2000);
