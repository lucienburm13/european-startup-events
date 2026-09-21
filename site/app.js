(() => {
  const cfg = window.EUSE_CONFIG || {};
  const state = { events: [], filtered: [], locations: {}, view: 'list', calendarCursor: startOfMonth(new Date()), source: 'snapshot', map: null, mapCollapsed: false };
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  function parseYmd(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1); }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(start,end){ const s=parseYmd(start), e=parseYmd(end||start); if(!s) return ''; const same=ymd(s)===ymd(e); const opt={day:'numeric',month:'short'}; if(same) return s.toLocaleDateString('en-GB',opt).toUpperCase(); if(s.getMonth()===e.getMonth()) return `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString('en-GB',{month:'short'}).toUpperCase()}`; return `${s.toLocaleDateString('en-GB',opt).toUpperCase()} – ${e.toLocaleDateString('en-GB',opt).toUpperCase()}`; }
  function monthLabel(d){ return d.toLocaleDateString('en-GB',{month:'long',year:'numeric'}); }
  function countryTokens(value){ return String(value||'').split(/\s*\/\s*|\s*;\s*/).map(x=>x.trim()).filter(x=>x && !/^(online|hybrid)$/i.test(x)); }
  function normalizeUrl(value){ try{ const u=new URL(String(value||'').trim()); return (u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/+$/,'')).toLowerCase(); }catch(_){ return String(value||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[?#].*$/,'').replace(/\/+$/,''); } }

  function loadJsonp(url){
    return new Promise((resolve,reject)=>{
      const callback='__euse_jsonp_'+Date.now()+'_'+Math.random().toString(36).slice(2);
      const script=document.createElement('script');
      const sep=url.includes('?')?'&':'?';
      const timer=setTimeout(()=>cleanup(new Error('JSONP timeout')),12000);
      function cleanup(err,data){ clearTimeout(timer); try{delete window[callback];}catch(_){window[callback]=undefined;} script.remove(); err?reject(err):resolve(data); }
      window[callback]=(data)=>cleanup(null,data);
      script.onerror=()=>cleanup(new Error('JSONP load failed'));
      script.src=url+sep+'prefix='+encodeURIComponent(callback);
      document.head.appendChild(script);
    });
  }

  async function loadEvents(){
    let data;
    if(window.EUSE_INLINE_EVENTS){ data=window.EUSE_INLINE_EVENTS; state.source='snapshot'; }
    if(!data && cfg.eventsApiUrl){
      try { data=await loadJsonp(cfg.eventsApiUrl); state.source='live'; }
      catch(err){ console.warn('Live feed unavailable; using snapshot.',err); }
    }
    if(!data){ const r=await fetch('./public/events.json',{cache:'no-store'}); data=await r.json(); state.source='snapshot'; }
    state.events=(data.events||data).filter(e=>e.start).sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
    try {
      const lr=await fetch('./public/locations.json',{cache:'no-store'});
      if(lr.ok){ const lj=await lr.json(); state.locations=lj.locations||{}; }
    } catch(err){ console.info('Location cache not available yet.'); }
    state.events=state.events.map(e=>{
      const hit=state.locations[`${e.city||''}|${e.country||''}`];
      return hit ? {...e,lat:hit.lat,lng:hit.lng} : e;
    });
    populateTypes(); populateCountries(); applyUrlState(); applyFilters();
  }

  function applyUrlState(){
    const p=new URLSearchParams(location.search);
    const setIfOption=(selector,value)=>{ const el=$(selector); if(value && [...el.options].some(o=>o.value===value)) el.value=value; };
    setIfOption('#filter-period',p.get('period'));
    setIfOption('#filter-calendar',p.get('type'));
    setIfOption('#filter-country',p.get('country'));
    if(p.get('q')) $('#filter-search').value=p.get('q');
    if(p.get('from')) $('#filter-from').value=p.get('from');
    if(p.get('to')) $('#filter-to').value=p.get('to');
    toggleCustomDates();
    const view=p.get('view');
    if(['list','calendar'].includes(view)){
      state.view=view;
      $$('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
      ['list','calendar'].forEach(v=>$(`#view-${v}`).hidden=v!==view);
    }
  }

  function syncUrl(){
    const p=new URLSearchParams();
    const period=$('#filter-period').value, type=$('#filter-calendar').value, country=$('#filter-country').value, q=$('#filter-search').value.trim();
    if(period!=='30') p.set('period',period);
    if(type!=='All') p.set('type',type);
    if(country!=='All') p.set('country',country);
    if(q) p.set('q',q);
    if(period==='custom'){
      if($('#filter-from').value) p.set('from',$('#filter-from').value);
      if($('#filter-to').value) p.set('to',$('#filter-to').value);
    }
    if(state.view!=='list') p.set('view',state.view);
    const next=p.toString()?`${location.pathname}?${p.toString()}`:location.pathname;
    history.replaceState(null,'',next);
  }

  function populateTypes(){
    const sel=$('#filter-calendar'), current=sel.value;
    const order=['Main','Additional','Policy','Commercial'];
    const found=[...new Set(state.events.map(e=>e.calendar).filter(Boolean))].sort((a,b)=>{
      const ai=order.indexOf(a), bi=order.indexOf(b);
      return (ai<0?99:ai)-(bi<0?99:bi) || a.localeCompare(b);
    });
    sel.innerHTML='<option value="All">All events</option>';
    found.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
    if([...sel.options].some(o=>o.value===current)) sel.value=current;
  }

  function populateCountries(){
    const sel=$('#filter-country'), current=sel.value;
    const countries=[...new Set(state.events.flatMap(e=>countryTokens(e.country)))].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML='<option value="All">All countries</option>';
    countries.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
    if([...sel.options].some(o=>o.value===current)) sel.value=current;
  }

  function periodMatch(e,period){
    const start=parseYmd(e.start), end=parseYmd(e.end||e.start); if(!start||!end) return false;
    const today=new Date(); today.setHours(0,0,0,0);
    if(period==='upcoming') return end>=today;
    if(period==='thisYear'){ const to=new Date(today.getFullYear(),11,31); return end>=today && start<=to; }
    if(period==='nextYear'){ const y=today.getFullYear()+1, from=new Date(y,0,1), to=new Date(y,11,31); return end>=from && start<=to; }
    if(period==='past90'){ const from=addDays(today,-90), to=addDays(today,-1); return end>=from && start<=to; }
    if(period==='custom'){
      const from=$('#filter-from').value?parseYmd($('#filter-from').value):null;
      const to=$('#filter-to').value?parseYmd($('#filter-to').value):null;
      if(from && end<from) return false;
      if(to && start>to) return false;
      return Boolean(from||to);
    }
    const max=addDays(today,Number(period));
    return end>=today && start<=max;
  }

  function toggleCustomDates(){
    const custom=$('#filter-period').value==='custom';
    $('#custom-dates').hidden=!custom;
  }

  function activeDateRange(){
    const period=$('#filter-period').value;
    const today=new Date(); today.setHours(0,0,0,0);
    if(period==='30') return {from:today,to:addDays(today,30)};
    if(period==='90') return {from:today,to:addDays(today,90)};
    if(period==='thisYear') return {from:today,to:new Date(today.getFullYear(),11,31)};
    if(period==='nextYear'){ const y=today.getFullYear()+1; return {from:new Date(y,0,1),to:new Date(y,11,31)}; }
    if(period==='past90') return {from:addDays(today,-90),to:addDays(today,-1)};
    if(period==='custom') return {from:$('#filter-from').value?parseYmd($('#filter-from').value):null,to:$('#filter-to').value?parseYmd($('#filter-to').value):null};
    if(period==='upcoming'){
      const ends=state.events.map(e=>parseYmd(e.end||e.start)).filter(Boolean).sort((a,b)=>a-b);
      return {from:today,to:ends.length?ends[ends.length-1]:null};
    }
    return {from:null,to:null};
  }

  function shortDate(d,withYear=true){
    if(!d) return '';
    const opts={day:'numeric',month:'short'};
    if(withYear) opts.year='numeric';
    return d.toLocaleDateString('en-GB',opts);
  }

  function dateRangeLabel(){
    const {from,to}=activeDateRange();
    if(from && to){
      const sameYear=from.getFullYear()===to.getFullYear();
      return sameYear ? `${shortDate(from,false)}–${shortDate(to,true)}` : `${shortDate(from,true)}–${shortDate(to,true)}`;
    }
    if(from) return `From ${shortDate(from,true)}`;
    if(to) return `Until ${shortDate(to,true)}`;
    return 'Choose dates';
  }

  function useCurrentRangeAsCustom(){
    const {from,to}=activeDateRange();
    $('#filter-period').value='custom';
    if(from) $('#filter-from').value=ymd(from);
    if(to) $('#filter-to').value=ymd(to);
    toggleCustomDates();
    applyFilters();
    $('#filter-from').focus();
  }

  function countryMatch(e,country){ return country==='All' || countryTokens(e.country).includes(country); }

  function applyFilters(){
    const period=$('#filter-period').value, cal=$('#filter-calendar').value, country=$('#filter-country').value, q=$('#filter-search').value.trim().toLowerCase();
    state.filtered=state.events.filter(e=>periodMatch(e,period) && (cal==='All'||e.calendar===cal) && countryMatch(e,country) && (!q||[e.name,e.title,e.city,e.country,e.venue,e.notes,e.calendar,e.status].join(' ').toLowerCase().includes(q)));
    $('#result-count').textContent=`${state.filtered.length} event${state.filtered.length===1?'':'s'}`;
    $('#source-note').textContent=dateRangeLabel();
    const add=$('#add-selection');
    if(add) add.textContent=state.filtered.length===1?'Add this event to calendar':`Add ${state.filtered.length} events to calendar`;
    syncUrl(); renderCurrent(); renderMap(); renderSelectionCalendar();
  }

  function renderCurrent(){ if(state.view==='list') renderList(); if(state.view==='calendar') renderCalendar(); }

  function renderList(){
    const el=$('#view-list');
    if(!state.filtered.length){ el.innerHTML='<div class="empty-state">No events match these filters.</div>'; return; }
    el.innerHTML=state.filtered.map(e=>`<article class="event-row" id="event-${esc(e.id)}">
      <div class="event-date">${esc(fmtDate(e.start,e.end))}<small>${esc(parseYmd(e.start)?.getFullYear()||'')}</small></div>
      <div class="event-main"><h3>${esc(e.title||e.name)}</h3><p class="event-meta">${esc([e.venue,e.city,e.country].filter(Boolean).join(' · '))}</p>${e.notes?`<p class="event-notes">${esc(e.notes)}</p>`:''}<div class="event-links">${e.source?`<a href="${esc(e.source)}" target="_blank" rel="noopener">Official source ↗</a>`:''}<button class="inline-action" data-add-event="${esc(e.id)}">Add to calendar</button><span>Verified ${esc(e.lastVerified||'—')}</span></div></div>
      <div class="event-type"><span class="pill status-${esc(e.status)}">${esc(e.status)}</span><div class="event-calendar-name">${esc(e.calendar)}</div></div>
    </article>`).join('');
    $$('[data-add-event]').forEach(b=>b.onclick=()=>openEventCalendar(b.dataset.addEvent));
  }

  function renderCalendar(){
    const el=$('#view-calendar'), cursor=state.calendarCursor;
    const first=startOfMonth(cursor), start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
    const end=new Date(start); end.setDate(end.getDate()+41);
    const byDay={};
    state.filtered.forEach(e=>{ const s=parseYmd(e.start), fin=parseYmd(e.end||e.start); if(!s||!fin) return; for(let d=new Date(s);d<=fin;d=addDays(d,1)){ const k=ymd(d); (byDay[k]??=[]).push(e); if((d-s)/86400000>14) break; } });
    const days=[]; for(let d=new Date(start);d<=end;d=addDays(d,1)) days.push(new Date(d));
    const monthEvents=state.filtered.filter(e=>{ const s=parseYmd(e.start), fin=parseYmd(e.end||e.start); const from=new Date(cursor.getFullYear(),cursor.getMonth(),1), to=new Date(cursor.getFullYear(),cursor.getMonth()+1,0); return s<=to && fin>=from; });
    const initial=monthEvents[0]||state.filtered[0]||null;
    el.innerHTML=`<div class="calendar-toolbar"><h2>${esc(monthLabel(cursor))}</h2><div><button class="mini-button" data-cal="prev">←</button><button class="mini-button" data-cal="today">Today</button><button class="mini-button" data-cal="next">→</button></div></div>
      <div id="calendar-preview" class="calendar-preview">${calendarPreviewHtml(initial)}</div>
      <div class="mobile-swipe-note">Swipe calendar horizontally →</div>
      <div class="calendar-scroll"><div class="month-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div class="weekday">${x}</div>`).join('')}${days.map(d=>{ const arr=byDay[ymd(d)]||[]; return `<div class="day-cell ${d.getMonth()!==cursor.getMonth()?'outside':''}"><div class="day-number">${d.getDate()}</div>${arr.slice(0,3).map(e=>`<button class="day-event ${esc(e.calendar)}" data-cal-event="${esc(e.id)}">${esc(e.name)}</button>`).join('')}${arr.length>3?`<div class="more-events">+${arr.length-3} more</div>`:''}</div>`; }).join('')}</div></div>`;
    $$('[data-cal]').forEach(b=>b.onclick=()=>{ if(b.dataset.cal==='prev') state.calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth()-1,1); if(b.dataset.cal==='next') state.calendarCursor=new Date(cursor.getFullYear(),cursor.getMonth()+1,1); if(b.dataset.cal==='today') state.calendarCursor=startOfMonth(new Date()); renderCalendar(); });
    $$('[data-cal-event]').forEach(b=>{
      const show=()=>{ const e=state.events.find(x=>String(x.id)===String(b.dataset.calEvent)); $('#calendar-preview').innerHTML=calendarPreviewHtml(e); bindCalendarPreview(); };
      b.addEventListener('mouseenter',show); b.addEventListener('focus',show); b.addEventListener('click',show);
    });
    bindCalendarPreview();
  }

  function calendarPreviewHtml(e){
    if(!e) return '<span>Hover or tap an event to see details.</span>';
    return `<div><strong>${esc(e.title||e.name)}</strong><span>${esc(fmtDate(e.start,e.end))} · ${esc([e.city,e.country].filter(Boolean).join(', '))}</span></div><div class="preview-actions">${e.source?`<a href="${esc(e.source)}" target="_blank" rel="noopener">Official source ↗</a>`:''}<button class="inline-action" data-preview-add="${esc(e.id)}">Add to calendar</button></div>`;
  }

  function bindCalendarPreview(){
    const b=$('[data-preview-add]'); if(b) b.onclick=()=>openEventCalendar(b.dataset.previewAdd);
  }

  function renderMap(){
    const el=$('#view-map');
    if(state.map){ try{ state.map.remove(); }catch(_){} state.map=null; }
    if(state.mapCollapsed){ el.hidden=true; return; }
    el.hidden=false;
    const mappable=state.filtered.filter(e=>Number.isFinite(Number(e.lat))&&Number.isFinite(Number(e.lng)));
    if(!mappable.length){ el.innerHTML=`<div class="map-shell"><div><h2>No mapped locations in this selection.</h2><p>${state.filtered.length} events match the current filters.</p></div></div>`; return; }
    if(!window.maplibregl){ el.innerHTML='<div class="map-shell"><div><h2>Map library unavailable.</h2><p>The list and calendar remain available.</p></div></div>'; return; }
    const groups=new Map();
    mappable.forEach(e=>{ const lat=Number(e.lat), lng=Number(e.lng), key=`${lat.toFixed(5)}|${lng.toFixed(5)}`; if(!groups.has(key)) groups.set(key,{lat,lng,events:[]}); groups.get(key).events.push(e); });
    const missing=state.filtered.length-mappable.length;
    el.innerHTML=`<div class="map-meta"><span><strong>${mappable.length}</strong> mapped event${mappable.length===1?'':'s'} at <strong>${groups.size}</strong> location${groups.size===1?'':'s'}.</span>${missing?`<span>${missing} event${missing===1?' is':'s are'} not mapped yet.</span>`:''}</div><div id="event-map" class="event-map" aria-label="Map of filtered events"></div>`;
    state.map=new maplibregl.Map({container:'event-map',style:cfg.mapStyleUrl||'https://tiles.openfreemap.org/styles/liberty',center:[10,50],zoom:3});
    state.map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    const bounds=new maplibregl.LngLatBounds();
    let activePopup=null;
    groups.forEach(group=>{
      bounds.extend([group.lng,group.lat]);
      group.events.sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
      const sample=group.events[0], location=[sample.city,sample.country].filter(Boolean).join(', ');
      const items=group.events.slice(0,12).map(e=>{ const title=esc(e.title||e.name), date=esc(fmtDate(e.start,e.end)); return `<li><strong>${title}</strong><span>${date} · ${esc(e.calendar)}</span><button class="popup-action" data-popup-add="${esc(e.id)}">Add to calendar</button></li>`; }).join('');
      const showLabel=group.events.length===1?'Show this event':`Show these ${group.events.length} events`;
      const popup=new maplibregl.Popup({offset:18,maxWidth:'380px',closeButton:true}).setLngLat([group.lng,group.lat]).setHTML(`<div class="map-popup"><strong>${esc(location||'Mapped location')}</strong><ul>${items}</ul><button class="outline-button compact-button popup-filter" data-map-location="${esc(sample.city||sample.country||'')}">${showLabel}</button></div>`);
      const marker=document.createElement('button'); marker.className='map-count-marker'; marker.type='button'; marker.textContent=String(group.events.length); marker.setAttribute('aria-label',`${group.events.length} events in ${location}`);
      const mapMarker=new maplibregl.Marker({element:marker}).setLngLat([group.lng,group.lat]).addTo(state.map);
      const open=()=>{ if(activePopup&&activePopup!==popup) activePopup.remove(); popup.addTo(state.map); activePopup=popup; };
      marker.addEventListener('mouseenter',open); marker.addEventListener('focus',open); marker.addEventListener('click',open);
      mapMarker.setPopup(popup);
    });
    el.addEventListener('click',evt=>{
      const add=evt.target.closest('[data-popup-add]'); if(add){ evt.preventDefault(); openEventCalendar(add.dataset.popupAdd); return; }
      const filter=evt.target.closest('[data-map-location]'); if(filter){ evt.preventDefault(); $('#filter-search').value=filter.dataset.mapLocation; applyFilters(); document.querySelector('.results-head')?.scrollIntoView({behavior:'smooth',block:'start'}); }
    },{once:false});
    const groupList=[...groups.values()];
    const selectedCountry=$('#filter-country').value;
    if(selectedCountry!=='All'){
      if(groupList.length===1){
        state.map.setCenter([groupList[0].lng,groupList[0].lat]);
        state.map.setZoom(6);
      } else {
        state.map.fitBounds(bounds,{padding:55,maxZoom:6,duration:0});
      }
    } else {
      // Keep a stable Europe overview when changing type, period or search.
      // This avoids markers at the edge (for example Dublin) disappearing because
      // the map keeps re-fitting itself to every filtered set.
      state.map.fitBounds([[-12,34],[45,72]],{padding:35,maxZoom:4,duration:0});
    }
  }

  function icsEscape(s=''){ return String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
  function icsDate(s){ return String(s||'').replace(/-/g,''); }
  function buildIcs(events,name='European Startup Events'){
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//European Startup Events//Export//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH',`X-WR-CALNAME:${icsEscape(name)}`];
    events.forEach(e=>{
      const endExclusive=ymd(addDays(parseYmd(e.end||e.start),1));
      lines.push('BEGIN:VEVENT',`UID:euse-${e.id}@european-startup-events`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${icsDate(e.start)}`,`DTEND;VALUE=DATE:${icsDate(endExclusive)}`,`SUMMARY:${icsEscape(e.title||e.name)}`);
      const loc=[e.venue,e.city,e.country].filter(Boolean).join(', '); if(loc) lines.push(`LOCATION:${icsEscape(loc)}`);
      if(e.source) lines.push(`URL:${e.source}`);
      lines.push('TRANSP:TRANSPARENT','CLASS:PUBLIC','END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function downloadIcs(events,filename,name){
    if(!events.length) return;
    const blob=new Blob([buildIcs(events,name)],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function googleEventUrl(e){
    const start=icsDate(e.start), end=icsDate(ymd(addDays(parseYmd(e.end||e.start),1)));
    const p=new URLSearchParams({action:'TEMPLATE',text:e.title||e.name,dates:`${start}/${end}`,details:e.source?`Official source: ${e.source}`:'',location:[e.venue,e.city,e.country].filter(Boolean).join(', ')});
    return 'https://calendar.google.com/calendar/render?'+p.toString();
  }

  function openEventCalendar(id){
    const e=state.events.find(x=>String(x.id)===String(id)); if(!e) return;
    $('#event-calendar-title').textContent=e.title||e.name;
    $('#event-calendar-meta').textContent=`${fmtDate(e.start,e.end)} · ${[e.city,e.country].filter(Boolean).join(', ')}`;
    $('#event-google-link').href=googleEventUrl(e);
    $('#event-ics-download').onclick=()=>downloadIcs([e],`european-startup-event-${e.id}.ics`,e.name);
    $('#modal-event-calendar').hidden=false;
  }

  function downloadSelectionIcs(){
    downloadIcs(state.filtered,'european-startup-events-selection.ics','European Startup Events — current selection');
  }

  function renderSelectionCalendar(){
    const box=$('#calendar-selection'); if(!box) return;
    const n=state.filtered.length;
    box.innerHTML=`<div class="calendar-option selection-option"><div><strong>Add ${n} event${n===1?'':'s'} to your calendar</strong><div class="stack-meta">One-time .ics export of exactly the events matching the filters on this page.</div></div><button class="solid-button compact-button" id="download-selection">Download .ics</button></div>`;
    $('#download-selection').onclick=downloadSelectionIcs;
  }

  function calendarLinks(){
    const box=$('#calendar-options');
    box.innerHTML=Object.entries(cfg.calendars||{}).map(([name,v])=>{ const id=v.id, google=`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(id)}`, ical=`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`; return `<div class="calendar-option"><div><strong>${esc(name)}</strong><div class="stack-meta">Live subscription; additions and corrections keep syncing.</div></div><div class="calendar-links"><a href="${google}" target="_blank" rel="noopener">Google</a><a href="${ical}">iCal</a></div></div>`; }).join('');
  }

  function renderStack(){
    const stack=cfg.stack||{}, layers=stack.layers||[], production=stack.production||[];
    const active=layers.filter(x=>!['planned','pending'].includes(x.status));
    const eu=active.filter(x=>x.status==='european').length, open=active.filter(x=>x.status==='open').length;
    const euScore=active.length?Math.round(eu/active.length*100):0, openScore=active.length?Math.round(open/active.length*100):0;
    $('#stack-eu-footer').textContent=`${euScore}%`;
    $('#stack-open-footer').textContent=`${openScore}%`;
    $('#stack-title').textContent='European Stack Index';
    const layerRows=layers.map(l=>`<div class="stack-row"><div><strong>${esc(l.flag)} ${esc(l.name)}</strong><div>${esc(l.provider)}</div><div class="stack-meta">${esc(l.country)}</div></div><div class="stack-status">${esc(l.status.replace('-',' '))}</div></div>`).join('');
    const productionRows=production.map(l=>`<div class="stack-row"><div><strong>${esc(l.flag)} ${esc(l.name)}</strong><div>${esc(l.provider)}</div><div class="stack-meta">${esc(l.country)}</div></div><div class="stack-status">${esc(l.status.replace('-',' '))}</div></div>`).join('');
    $('#stack-table').innerHTML=`<div class="stack-score-grid"><div><strong>${euScore}%</strong><span>EU stack</span></div><div><strong>${openScore}%</strong><span>Open Source</span></div></div><p class="stack-note">Share of the active website stack. Planned layers do not count yet.</p><h3 class="modal-subhead">Website stack</h3>${layerRows}<h3 class="modal-subhead">Production &amp; maintenance · not scored</h3>${productionRows}`;
  }

  function setupModals(){
    $$('[data-open]').forEach(b=>b.onclick=()=>{$(`#modal-${b.dataset.open}`).hidden=false; if(b.dataset.open==='calendar-help') renderSelectionCalendar();});
    $$('[data-close]').forEach(b=>b.onclick=()=>b.closest('.modal-backdrop').hidden=true);
    $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));
  }

  function resetSubmitModal(){
    $('#submit-intro').hidden=false;
    $('#submit-form').hidden=false;
    $('#tally-submit-wrap').hidden=true;
    $('#tally-submit-frame').removeAttribute('src');
  }

  function openSubmit(){
    resetSubmitModal();
    $('#modal-submit').hidden=false;
    const u=$('#submission-url').value.trim(); if(u) $('#submit-url-full').value=u;
    $('#submit-status').textContent='';
  }

  function findDuplicate(url){
    const n=normalizeUrl(url); if(!n) return null;
    return state.events.find(e=>normalizeUrl(e.source)===n) || null;
  }
  function continueToTally(data){
    if(!cfg.tallyFormUrl){ $('#submit-status').textContent='Duplicate check passed. The submission endpoint is not connected yet.'; return; }
    const u=new URL(cfg.tallyFormUrl);
    u.pathname=u.pathname.replace(/^\/r\//,'/embed/');
    if(data.url) u.searchParams.set('url',data.url);
    u.searchParams.set('source','website');
    u.searchParams.set('hideTitle','1');
    u.searchParams.set('alignLeft','1');
    u.searchParams.set('transparentBackground','1');
    $('#submit-intro').hidden=true;
    $('#submit-form').hidden=true;
    $('#tally-submit-frame').src=u.toString();
    $('#tally-submit-wrap').hidden=false;
  }

  function submitEvent(ev){
    ev.preventDefault();
    const data=Object.fromEntries(new FormData(ev.currentTarget).entries()), status=$('#submit-status'), url=String(data.url||'').trim();
    if(!url){ status.textContent='Please add the official public event URL.'; return; }
    const duplicate=findDuplicate(url);
    if(duplicate){ status.innerHTML=`Already listed: <a href="${esc(duplicate.source||'#')}" target="_blank" rel="noopener"><strong>${esc(duplicate.title||duplicate.name)}</strong></a> · ${esc(fmtDate(duplicate.start,duplicate.end))}.`; return; }
    continueToTally({url});
  }

  function setup(){
    ['#filter-calendar','#filter-country'].forEach(s=>$(s).addEventListener('change',applyFilters));
    $('#filter-period').addEventListener('change',()=>{ toggleCustomDates(); applyFilters(); });
    ['#filter-from','#filter-to'].forEach(s=>$(s).addEventListener('change',applyFilters));
    $('#filter-search').addEventListener('input',applyFilters);
    $('#source-note').addEventListener('click',useCurrentRangeAsCustom);
    $$('[data-view]').forEach(b=>b.onclick=()=>{ state.view=b.dataset.view; $$('[data-view]').forEach(x=>x.classList.toggle('active',x===b)); ['list','calendar'].forEach(v=>$(`#view-${v}`).hidden=v!==state.view); syncUrl(); renderCurrent(); });
    $('#toggle-map').onclick=()=>{ state.mapCollapsed=!state.mapCollapsed; $('#toggle-map').textContent=state.mapCollapsed?'Show map':'Hide map'; $('#toggle-map').setAttribute('aria-expanded',String(!state.mapCollapsed)); renderMap(); };
    $('#add-selection').onclick=()=>{ $('#modal-calendar-help').hidden=false; renderSelectionCalendar(); };
    $('#submit-top').onclick=openSubmit; $('#submit-card').onclick=openSubmit;
    $('#submission-url').addEventListener('keydown',e=>{if(e.key==='Enter')openSubmit();});
    $('#submit-form').addEventListener('submit',submitEvent);
    setupModals(); calendarLinks(); renderStack(); loadEvents();
  }

  document.addEventListener('DOMContentLoaded',setup);
})();