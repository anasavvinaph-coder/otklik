const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const kinds = {book:'Книга',film:'Фильм',painting:'Картина'};
const state = {question:'', refinement:'', filter:'all', works:[], busy:false, sequence:0};
const api = String(window.OTKLIK_API_URL || '').replace(/\/+$/, '');
function markBusy(busy) { state.busy=busy; $('search-button').disabled=busy; $('refine-button').disabled=busy; }
function message(msg) { $('results-intro').textContent=msg; $('work-grid').innerHTML=`<div class="loading">${esc(msg)}</div>`; }
function normalUrl(url) {
  if (typeof url !== 'string') return '';
  try { const u = new URL(url); if (u.protocol !== 'https:') return ''; if (u.hostname==='wikipedia.org' || /(^|\.)wikipedia\.org$/i.test(u.hostname)) return u.hostname === 'ru.wikipedia.org' ? u.href : '';
    if (u.hostname.endsWith('.ru') || u.hostname.endsWith('.рф') || u.hostname === 'arzamas.academy' || u.hostname === 'polka.academy' || u.hostname === 'gorky.media') return u.href;
    return ''; } catch { return ''; }
}
function render() {
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.type===state.filter));
  const filtered=state.works.filter(w=>state.filter==='all' || w.type===state.filter);
  $('total').textContent=filtered.length ? `${filtered.length} произведений` : '';
  const grid=$('work-grid');
  if(!filtered.length) { grid.innerHTML='<div class="empty">Не нашлось достаточно убедительных произведений.<p>Можно уточнить вопрос или попробовать другую формулировку. Отклик не подменяет смысловую выдачу случайными совпадениями слов.</p></div>'; return; }
  grid.innerHTML=filtered.map((w,i)=>{
    const u=normalUrl(w.url);
    return `<article class="work"><div class="work-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</div><div class="work-body"><div class="work-type">${kinds[w.type]||'Произведение'}</div><h3>${esc(w.title)}</h3><p class="work-author">${esc(w.creator||'Автор не указан')}${w.year?', '+esc(w.year):''}</p><p class="work-why">${esc(w.why)}</p>${u?`<a class="work-link" href="${esc(u)}" rel="noopener noreferrer" target="_blank">Читать о произведении ↗</a>`: w.wikiSearch?`<a class="work-link" href="${esc(w.wikiSearch)}" rel="noopener noreferrer" target="_blank">Найти в русской Википедии ↗</a>`:''}</div></article>`;
  }).join('');
}
async function search(question,refinement='',noScroll=false) {
  if(state.busy || !question.trim() || question.trim().length<2)return;
  state.question=question.trim(); state.refinement=refinement.trim(); state.filter='all';
  const seq=++state.sequence;
  document.body.classList.add('searched'); $('query').value=state.question;
  $('results-query').textContent=state.question;
  $('active-refine').classList.toggle('show',!!state.refinement); $('refine-label').textContent=state.refinement;
  $('refine-input').value=''; markBusy(true);
  $('mode-indicator').textContent='Смысловой поиск · русский язык';
  $('disclaimer').textContent='Каждое произведение проходит дополнительную смысловую проверку. Изображений нет. Оценка ИИ может ошибаться.';
  message('Ищем произведения и проверяем смысловую связь…');
  try {
    if(!api || !/^https:\/\//.test(api)) throw Error('Поиск ещё не подключён. Нужно указать адрес Worker в файле config.js.');
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),46000);
    let response;
    try { response=await fetch(`${api}/search`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:state.question,refinement:state.refinement}),signal:controller.signal}); }
    finally { clearTimeout(timeout); }
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(data.error||'Сервис поиска временно недоступен.');
    
if(data.version!=='2026-11-26-search-separated' || !Array.isArray(data.works)) throw Error('Версия поискового сервера несовместима с сайтом.');
    if(seq!==state.sequence)return;
    state.works=Array.isArray(data.works)?data.works:[];
    $('results-intro').textContent=data.intro || 'Подборка произведений, раскрывающих разные стороны вопроса.';
    render();
    if(!state.works.length) $('results-intro').textContent='Среди найденных произведений не оказалось достаточно убедительных. Попробуйте уточнить тему.';
  } catch(err) {
    state.works=[]; $('total').textContent='';
    $('results-intro').textContent='Не удалось завершить поиск.';
    $('work-grid').innerHTML=`<div class="empty">Поиск недоступен<p>${esc(err.name==='AbortError'?'Поиск занял слишком много времени. Попробуйте ещё раз.':err.message)}</p></div>`;
  } finally {markBusy(false);}
  if(!noScroll)requestAnimationFrame(()=>$('results').scrollIntoView({block:'start',behavior:'smooth'}));
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();search($('query').value);});
$('refine-form').addEventListener('submit',e=>{e.preventDefault();const r=$('refine-input').value.trim();if(r)search(state.question,[state.refinement,r].filter(Boolean).join('; '),true);});
$('refine-reset').addEventListener('click',()=>search(state.question,'',true));
for(const b of document.querySelectorAll('[data-query]')) b.addEventListener('click',()=>search(b.dataset.query));
for(const b of document.querySelectorAll('.tab')) b.addEventListener('click',()=>{state.filter=b.dataset.type;render();});
$('home').addEventListener('click',()=>{state.sequence++;document.body.classList.remove('searched');state.question='';state.refinement='';state.works=[];$('query').value='';window.scrollTo({top:0,behavior:'smooth'});});
