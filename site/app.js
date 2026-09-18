(() => {
  const cfg = window.EUSE_CONFIG || {};
  const state = { events: [], filtered: [], view: 'list', calendarCursor: startOfMonth(new Date()), source: 'snapshot' };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  function parseYmd(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1); }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(start,end){ const s=parseYmd(start), e=parseYmd(end||start); if(!s) return ''; const same=ymd(s)===ymd(e); const opt={day:'numeric',month:'short'}; if(same) return s.toLocaleDateString('en-GB',opt).toUpperCase(); if(s.getMonth()===e.getMonth()) return `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString('en-GB',{month:'short'}).toUpperCase()}`; return `${s.toLocaleDateString('en-GB',opt).toUpperCase()} – ${e.toLocaleDateString('en-GB',opt).toUpperCase()}`; }
  function monthLabel(d){ return d.toLocaleDateString('en-GB',{month:'long',year:'numeric'}); }

  async function loadEvents(){
    let data;
    if(cfg.eventsApiUrl){
      try { const r=await fetch(cfg.eventsApiUrl,{cache:'no-store'}); if(!r.ok) throw new Error(`HTTP ${r.status}`); data=await r.json(); state.source='live'; }
      catch(err){ console.warn('Live feed unavailable; using snapshot.',err); }
    }
    if(!data){ const r=await fetch('./public/events.json',{cache:'no-store'}); data=await r.json(); state.source='snapshot'; }
    state.events=(data.events||data).filter(e=>e.start).sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
    populateCountries(); applyFilters();
  }

  function populateCountries(){
    const sel=$('#filter-country');
    const current=sel.value;
    [...new Set(state.events.map(e=>e.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).forEach(c=>{ const o=document.createElement('option'); o.value=c;o.textContent=c;sel.appendChild(o); });
    if([...sel.options].some(o=>o.value===current)) sel.value=current;
  }

  function periodMatch(e,period){
    const d=parseYmd(e.start); if(!d) return false;
    if(period==='all') return true;
    if(period==='2026'||period==='2027') return d.getFullYear()===Number(period);
    const today=new Date(); today.setHours(0,0,0,0); const max=addDays(today,Number(period));
    return d>=today && d<=max;
  }

  function applyFilters(){
    const period=$('#filter-period').value, cal=$('#filter-calendar').value, country=$('#filter-country').value, q=$('#filter-search').value.trim().toLowerCase();
    state.filtered=state.events.filter(e=>periodMatch(e,period) && (cal==='All'||e.calendar===cal) && (country==='All'||e.country===country) && (!q||[e.name,e.title,e.city,e.country,e.venue,e.notes,e.calendar,e.status].join(' ').toLowerCase().includes(q)));
    $('#result-count').textContent=`${state.filtered.length} event${state.filtered.length===1?'':'s'}`;
    $('#source-note').textContent=state.source==='live'?'live from master':'current master snapshot';
    renderCurrent();
  }

  function renderCurrent(){ if(state.view==='list') renderList(); if(state.view==='calendar') renderCalendar(); if(state.view==='map') renderMap(); }

  function renderList(){
    const el=$('#view-list');
    if(!state.filtered.length){ el.innerHTML='<div class="empty-state">No events match these filters.</div>'; return; }
    el.innerHTML=state.filtered.map(e=>`<article class="event-row" id="event-${esc(e.id)}">
      <div class="event-date">${esc(fmtDate(e.start,e.end))}<small>${esc(parseYmd(e.start)?.getFullYear()||'')}</small></div>
      <div class="event-main"><h3>${esc(e.title||e.name)}</h3><p class="event-meta">${esc([e.venue,e.city,e.country].filter(Boolean).join(' · '))}</p>${e.notes?`<p class="event-notes">${esc(e.notes)}</p>`:''}<div class="event-links">${e.source?`<a href="${esc(e.source)}" target="_blank" rel="noopener">Official source ↗</a>`:''}<span>Verified ${esc(e.lastVerified||'—')}</span></div></div>
      <div class="event-type"><span class="pill status-${esc(e.status)}">${esc(e.status)}</span><div style="margin-top:8px;font-size:12px;color:#666">${esc(e.calendar)}</div></div>
    </article>`).join('');
  }

  function renderCalendar(){
    const el=$('#view-calendar'), cursor=state.calendarCursor;
    const first=startOfMonth(cursor), start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
    const end=new Date(start); end.setDate(end.getDate()+41);
    const byDay={};
    state.filtered.forEach(e=>{ const s=parseYmd(e.start), fin=parseYmd(e.end||e.start); if(!s||!fin) return; for(let d=new Date(s);d<=fin;d=addDays(d,1)){ const k=ymd(d); (byDay[k]??=[]).push(e); if((d-s)/86400000>14) break; } });
    const days=[]; for(let d=new Date(start);d<=end;d=addDays(d,1)) days.push(new Date(d));
    el.innerHTML=`<div class="calendar-toolbar"><h2>${esc(monthLabel(cursor))}</h2><div><button class="mini-button" data-cal="prev">←</button><button class="mini-button" data-cal="today">Today</button><button class="mini-button" data-cal="next">→</button></div></div><div class="month-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div class="weekday">${x}</div>`).join('')}${days.map(d=>{ const arr=byDay[ymd(d)]||[]; return `<div class="day-cell ${d.getMonth()!==cursor.getMonth()?'outside':''}"><div class="day-number">${d.getDate()}</div>${arr.slice(0,3).map(e=>`<a class="day-event ${esc(e.calendar)}" href="${e.source?esc(e.source):'#event-'+esc(e.id)}" ${e.source?'target="_blank" rel="noopener"':''}>${esc(e.name)}</a>`).join('')}${arr.length>3?`<div class="more-events">+${arr.length-3} more</div>`:''}</div>`; }).join('')}</div>`;
    $$('[data-cal]').forEach(b=>b.onclick=()=>{ if(b.dataset.cal==='prev') state.calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1); if(b.dataset.cal==='next') state.calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1); if(b.dataset.cal==='today') state.calendarCursor=startOfMonth(new Date()); renderCalendar(); });
  }

  function renderMap(){
    const el=$('#view-map');
    const pins=state.filtered.filter(e=>Number.isFinite(Number(e.lat))&&Number.isFinite(Number(e.lng)));
    if(!pins.length){ el.innerHTML=`<div class="map-shell"><div><p class="eyebrow">MAP VIEW</p><h2>Ready for coordinates.</h2><p>The map uses the same filters as List and Calendar. We will store latitude/longitude once in the master rather than geocoding visitors on every page load. No filtered events currently have coordinates in the master snapshot.</p><p><strong>${state.filtered.length}</strong> events are in the current selection.</p></div></div>`; return; }
    el.innerHTML=`<div class="map-shell"><div><h2>${pins.length} mapped events</h2><p>Coordinate rendering is enabled once the map provider is connected.</p></div></div>`;
  }

  function calendarLinks(){
    const box=$('#calendar-options');
    box.innerHTML=Object.entries(cfg.calendars||{}).map(([name,v])=>{ const id=v.id; const google=`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(id)}`; const ical=`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`; return `<div class="calendar-option"><div><strong>${esc(name)}</strong><div class="stack-meta">Continuous subscription; future changes sync automatically.</div></div><div class="calendar-links"><a href="${google}" target="_blank" rel="noopener">Google</a><a href="${ical}">iCal</a></div></div>`; }).join('');
  }

  function renderStack(){
    const stack=cfg.stack||{layers:[]}; const layers=stack.layers||[]; const eu=layers.filter(x=>x.status==='european').length; const resolved=layers.filter(x=>x.status!=='pending').length; const score=Math.round((eu/layers.length)*100); const activeLabel=stack.state==='planned'?'planned stack':'current stack';
    $('#stack-score-top').textContent=`${score}%`;
    $('#stack-score-footer').textContent=`${score}%`;
    $('#stack-summary').textContent=`European · ${activeLabel}`;
    $('#stack-title').textContent=`European Stack Index — ${score}%`;
    $('#stack-table').innerHTML=`<div class="stack-explainer"><strong>${eu}/${layers.length} layers</strong> currently classified as European in the ${activeLabel}. ${layers.length-resolved} layer${layers.length-resolved===1?' is':'s are'} still undecided. Open-source/standards layers are displayed separately and do not count as European ownership.</div>${layers.map(l=>`<div class="stack-row"><div><strong>${esc(l.flag)} ${esc(l.name)}</strong><div>${esc(l.provider)}</div><div class="stack-meta">${esc(l.country)}</div></div><div class="stack-status">${esc(l.status.replace('-',' '))}</div></div>`).join('')}`;
  }

  function setupModals(){
    $$('[data-open]').forEach(b=>b.onclick=()=>{$(`#modal-${b.dataset.open}`).hidden=false;});
    $$('[data-close]').forEach(b=>b.onclick=()=>b.closest('.modal-backdrop').hidden=true);
    $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));
  }

  function openSubmit(){
    if(cfg.tallyFormUrl){ window.open(cfg.tallyFormUrl,'_blank','noopener'); return; }
    $('#modal-submit').hidden=false;
    const u=$('#submission-url').value.trim(); if(u) $('#submit-url-full').value=u;
  }

  async function submitEvent(ev){
    ev.preventDefault(); const status=$('#submit-status'); const data=Object.fromEntries(new FormData(ev.currentTarget).entries());
    if(!cfg.submissionApiUrl){ status.textContent='Submission endpoint is not connected yet. The form is ready; the Apps Script endpoint is the next deployment step.'; return; }
    status.textContent='Submitting…';
    try{ const r=await fetch(cfg.submissionApiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'submitEvent',...data})}); const out=await r.json(); if(!r.ok||out.ok===false) throw new Error(out.error||`HTTP ${r.status}`); status.textContent='Submitted. We will verify it before publishing.'; ev.currentTarget.reset(); }
    catch(err){ console.error(err); status.textContent='Could not submit right now. Please try again later.'; }
  }

  function setup(){
    ['#filter-period','#filter-calendar','#filter-country'].forEach(s=>$(s).addEventListener('change',applyFilters)); $('#filter-search').addEventListener('input',applyFilters);
    $$('[data-view]').forEach(b=>b.onclick=()=>{ state.view=b.dataset.view; $$('[data-view]').forEach(x=>x.classList.toggle('active',x===b)); ['list','calendar','map'].forEach(v=>$(`#view-${v}`).hidden=v!==state.view); renderCurrent(); });
    $('#submit-top').onclick=openSubmit; $('#submit-card').onclick=openSubmit; $('#submission-url').addEventListener('keydown',e=>{if(e.key==='Enter')openSubmit();}); $('#submit-form').addEventListener('submit',submitEvent);
    setupModals(); calendarLinks(); renderStack(); loadEvents();
  }
  document.addEventListener('DOMContentLoaded',setup);
})();