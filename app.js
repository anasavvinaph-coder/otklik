import {MODEL_ID,INDEX_VERSION,flattenFacets,cosine,parseRefinement,makeQuery} from './semantic-core.mjs';
import {discoverLive,buildCandidatePassage,evidenceWhy,requestJson,fold} from './discovery.mjs';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>typeof s==='string'&&s.startsWith('https://')?s:'';
const state={busy:false,query:'',refinement:'',filter:'all',pool:[],results:[],catalog:null,index:null,model:null,gen:0,discovery:null,loadPromise:null};
const imageCache=new Map(),vectorCache=new Map(),kinds={book:'Книга',film:'Фильм',painting:'Живопись'};
function loading(message){$('results-intro').textContent=message;$('work-grid').innerHTML=`<div class="loading">${esc(message)}</div>`;}
function status(message){$('mode-indicator').textContent=message;}
async function readCatalog(){
 if(state.catalog)return state.catalog;
 const data=await requestJson('./catalog.json',{timeout:12000});
 if(!Array.isArray(data.works))throw Error('Не удалось получить редакционный каталог.');
 state.catalog=data;return data;
}
async function loadModel(){
 if(state.model)return state.model;
 if(!state.loadPromise){
  state.loadPromise=(async()=>{
   const {pipeline}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm');
   return pipeline('feature-extraction',MODEL_ID,{dtype:'q8',device:'wasm',progress_callback:p=>{
    if(p.status==='progress'&&p.progress!=null&&!state.discovery?.items){
      loading(`Загружаем модель смыслового поиска: ${Math.round(p.progress)}%. При первом посещении скачиваются её файлы.`);
    }
   }});
  })();
 }
 try{state.model=await state.loadPromise;return state.model;}
 catch(e){state.loadPromise=null;throw e;}
}
async function embed(texts){
 if(!texts.length)return [];
 const model=await loadModel();
 const out=await model(texts,{pooling:'mean',normalize:true});
 const d=Array.from(out.data);const dim=d.length/texts.length;
 if(!Number.isInteger(dim)||dim<100)throw Error('Некорректные смысловые векторы.');
 return Array.from({length:texts.length},(_,i)=>d.slice(i*dim,(i+1)*dim));
}
async function editorialIndex(catalog){
 if(state.index)return state.index;
 const facets=flattenFacets(catalog);
 try{
  const file=await requestJson('./semantic-index.json',{timeout:4000});
  if(file.model===MODEL_ID&&file.version===INDEX_VERSION&&file.dataset_version===catalog.version&&file.entries?.length===facets.length){state.index=file;return file;}
 }catch(_){}
 const cacheKey=`otklik-vectors-v3-${catalog.version}-${facets.length}`;
 try{
  const local=localStorage.getItem(cacheKey);
  if(local){const parsed=JSON.parse(local);if(parsed.entries?.length===facets.length){state.index=parsed;return parsed;}}
 }catch(_){}
 const entries=[];
 for(let i=0;i<facets.length;i+=8){
  const batch=facets.slice(i,i+8),vecs=await embed(batch.map(x=>x.text));
  batch.forEach((facet,j)=>entries.push({id:facet.id,facetIndex:facet.facetIndex,vector:vecs[j]}));
 }
 state.index={model:MODEL_ID,version:INDEX_VERSION,dataset_version:catalog.version,entries};
 try{localStorage.setItem(cacheKey,JSON.stringify(state.index));}catch(_){}
 return state.index;
}
async function compare(query,refinement,catalog,live){
 const [{entries},[queryVector]]=await Promise.all([editorialIndex(catalog),embed([makeQuery(query,refinement)])]);
 const results=[];
 const byId=new Map(catalog.works.map(w=>[w.id,w]));
 for(const row of entries){
   const w=byId.get(row.id),facet=w?.facets?.[row.facetIndex];if(!w||!facet)continue;
   const score=cosine(queryVector,row.vector);
   if(Number.isFinite(score))results.push({...w,why:facet.why,score,origin:'editorial'});
 }
 const allLive=live.items||[];
 for(let i=0;i<allLive.length;i+=8){
  const batch=allLive.slice(i,i+8);
  const missing=batch.filter(w=>!vectorCache.has(w.id));
  if(missing.length){
   const calculated=await embed(missing.map(buildCandidatePassage));
   missing.forEach((w,j)=>vectorCache.set(w.id,calculated[j]));
  }
  for(let j=0;j<batch.length;j++){
    const w=batch[j],score=cosine(queryVector,vectorCache.get(w.id));
    if(Number.isFinite(score))results.push({...w,score,origin:'internet',why:evidenceWhy(w)});
  }
 }
 // Compare representations, never raw matching words. Keep only the highest
 // scoring thematic facet and deduplicate translated editions when possible.
 const unique=new Map();
 for(const w of results){const key=w.type+'|'+fold(w.title);const prev=unique.get(key);if(!prev||prev.score<w.score)unique.set(key,w);}
 return [...unique.values()].sort((a,b)=>b.score-a.score);
}
function selectResults(type){
 let ranked=state.pool.filter(w=>!type||type==='all'||w.type===type);
 if(!ranked.length)return [];
 const best=ranked[0].score;
 // Threshold rejects weak, accidental relationships. Not a claim of verified
 // deep interpretation: automatic results remain explicitly labeled provisional.
 const min=Math.max(0.65,best-0.13);
 ranked=ranked.filter(w=>w.score>=min);
 const out=[],count={book:0,film:0,painting:0};let editorCount=0;
 for(const w of ranked){
  if(out.length>=14)break;
  if(type==='all' && (count[w.type]||0)>=7)continue;
  if(w.origin==='editorial'&&editorCount>=6)continue;
  out.push(w);count[w.type]=(count[w.type]||0)+1;
  if(w.origin==='editorial')editorCount++;
 }
 return out;
}
async function search(question,refinement='',{noScroll=false}={}){
 if(state.busy||question.trim().length<2)return;
 state.busy=true;state.query=question.trim();state.refinement=refinement.trim();state.filter=parseRefinement(refinement).type||'all';
 const gen=++state.gen;
 document.body.classList.add('searched');$('query').value=state.query;$('results-query').textContent=state.query;
 $('active-refine').classList.toggle('show',!!state.refinement);$('refine-label').textContent=state.refinement;
 $('refine-input').value='';$('search-button').disabled=true;$('refine-button').disabled=true;
 status('Открытые каталоги · без платного API');loading('Ищем произведения и их описания в открытых источниках…');
 try{
  // Start independent network work in parallel with local model preparation.
  const [catalog,live]=await Promise.all([readCatalog(),discoverLive(state.query+' '+state.refinement,{onProgress:message=>{
   if(gen===state.gen)loading(message);
  }})]);
  state.discovery=live;
  loading(`Найдено ${live.items.length} внешних кандидатов. Сопоставляем смыслы произведений…`);
  state.pool=await compare(state.query,state.refinement,catalog,live);
  render();
 }catch(error){
  console.error('Otklik search failed',error);state.pool=[];
  $('results-intro').textContent='Поиск не завершился. Проверь подключение к интернету и попробуй ещё раз.';
  $('work-grid').innerHTML='<div class="empty">Не удалось обработать запрос<p>Бесплатная модель запускается в браузере. Если она не загрузилась, сайт не подменяет поиск списком случайных совпадений.</p></div>';
  $('disclaimer').textContent='Сайт не обращается к платному API.';
 }finally{state.busy=false;$('search-button').disabled=false;$('refine-button').disabled=false;}
 if(!noScroll)requestAnimationFrame(()=>$('results').scrollIntoView({behavior:'smooth',block:'start'}));
}
function render(){
 const gen=++state.gen;
 document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.type===state.filter));
 const list=selectResults(state.filter);state.results=list;
 const live=state.discovery;
 $('results-intro').textContent=`Открытые каталоги: ${live?.items.length||0} произведений с описанием найдено для этого запроса. Мы сравниваем их смысл с вопросом, а не только совпадения слов.`;
 $('total').textContent=list.length?`${list.length} результатов`:'';
 $('disclaimer').textContent='Редакционные рекомендации имеют подготовленное смысловое объяснение. У автоматических находок связь предварительная: она основана на доступном описании, а не на анализе полного произведения. Бесплатный поиск не индексирует буквально весь интернет. Изображения подгружаются из открытых каталогов.';
 const grid=$('work-grid');
 if(!list.length){grid.innerHTML='<div class="empty">Не нашлось достаточно убедительных связей.<p>Пробуй иначе сформулировать вопрос или уточнить направление. Мы не показываем произведения только из-за совпадения слов.</p></div>';return;}
 grid.innerHTML=list.map((w,i)=>{
  const source=w.origin==='internet'?' · Найдено в интернете':'';
  return `<article class="work"><div class="cover ${w.type==='painting'?'painting':''}"><div class="no-image">Ищем изображение…</div><img class="hidden" loading="lazy" alt="${esc(kinds[w.type])}: ${esc(w.title)}"></div><div class="work-body"><div class="work-type">${String(i+1).padStart(2,'0')} / ${esc(kinds[w.type])}${source}</div><h3>${esc(w.title)}</h3><p class="work-author">${esc(w.creator||'Автор не указан')}${w.year?', '+esc(w.year):''}</p><p class="work-why">${esc(w.why)}</p><a class="work-link" href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener noreferrer">О произведении ↗</a></div></article>`;
 }).join('');
 hydrateImages(list,gen);
}
async function imageGood(url,timeout=4400){return new Promise(resolve=>{
 if(!safeUrl(url))return resolve(false);
 const temp=new Image();let settled=false;
 const finish=v=>{if(settled)return;settled=true;clearTimeout(timer);temp.onload=null;temp.onerror=null;resolve(v);};
 const timer=setTimeout(()=>finish(false),timeout);
 temp.onload=()=>finish(temp.naturalWidth>=80&&temp.naturalHeight>=80);temp.onerror=()=>finish(false);temp.src=url;
});}
async function fallbackCover(work){
 const urls=[];
 if(work.isbn)urls.push(`https://covers.openlibrary.org/b/isbn/${encodeURIComponent(work.isbn)}-M.jpg?default=false`);
 const title=work.lookup_title||work.title;
 try{
  const p=new URLSearchParams({title,fields:'key,title,author_name,cover_i',limit:'6'});
  const data=await requestJson('https://openlibrary.org/search.json?'+p,{timeout:6500});
  const target=fold(title);
  for(const d of data.docs||[]){
   if(!d.cover_i||fold(d.title)!==target)continue;
   urls.push(`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg?default=false`);
  }
 }catch(_){}
 return urls;
}
async function fallbackWikipedia(work){
 try{
  const url=new URL(work.url||'');
  const page=url.hostname.endsWith('.wikipedia.org')&&url.pathname.startsWith('/wiki/')?decodeURIComponent(url.pathname.slice(6)).replaceAll('_',' '):(work.lookup_title||work.title);
  const params=new URLSearchParams({action:'query',prop:'pageimages',titles:page,redirects:'1',piprop:'thumbnail',pithumbsize:'660',format:'json',origin:'*'});
  const host=url.hostname.endsWith('.wikipedia.org')?url.origin:'https://en.wikipedia.org';
  const data=await requestJson(host+'/w/api.php?'+params,{timeout:6700});
  return Object.values(data.query?.pages||{}).map(p=>p.thumbnail?.source).filter(safeUrl);
 }catch(_){return []}
}
async function filmArtwork(work){
 const title=work.lookup_title||work.title;
 try{
  const url='https://itunes.apple.com/search?'+new URLSearchParams({term:title,entity:'movie',media:'movie',limit:'12',country:'US'});
  const data=await requestJson(url,{timeout:6500});
  const wanted=fold(title);
  return (data.results||[]).filter(r=>fold(r.trackName||'')===wanted&&safeUrl(r.artworkUrl100))
   .map(r=>r.artworkUrl100.replace(/\d+x\d+bb/,'600x900bb'));
 }catch(_){return []}
}
async function imageCandidates(work){
 if(imageCache.has(work.id))return imageCache.get(work.id);
 const urls=[work.image];
 if(work.type==='book')urls.push(...await fallbackCover(work));
 if(work.type==='film')urls.push(...await filmArtwork(work),...await fallbackWikipedia(work));
 if(work.type==='painting')urls.push(...await fallbackWikipedia(work));
 const result=[...new Set(urls.filter(safeUrl))];imageCache.set(work.id,result);return result;
}
async function loadCover(work,img,gen){
 const urls=await imageCandidates(work);
 for(const url of urls){
  if(gen!==state.gen||!img.isConnected)return;
  if(await imageGood(url)){
   if(gen!==state.gen||!img.isConnected)return;
   img.src=url;img.classList.remove('hidden');img.parentElement.classList.add('has-image');return;
  }
 }
 if(gen===state.gen&&img.isConnected)img.parentElement.querySelector('.no-image').textContent='Изображение недоступно';
}
async function hydrateImages(works,gen){
 const images=[...document.querySelectorAll('.work img')];let next=0;
 async function worker(){while(next<works.length){const i=next++;if(gen!==state.gen)return;await loadCover(works[i],images[i],gen);}}
 await Promise.all(Array.from({length:Math.min(4,works.length)},worker));
}
$('search-form').addEventListener('submit',e=>{e.preventDefault();search($('query').value);});
$('refine-form').addEventListener('submit',e=>{e.preventDefault();const ref=$('refine-input').value.trim();if(ref)search(state.query,[state.refinement,ref].filter(Boolean).join('; '),{noScroll:true});});
$('refine-reset').addEventListener('click',()=>search(state.query,'',{noScroll:true}));
for(const b of document.querySelectorAll('[data-query]'))b.addEventListener('click',()=>{$('query').value=b.dataset.query;search(b.dataset.query);});
for(const b of document.querySelectorAll('.tab'))b.addEventListener('click',()=>{state.filter=b.dataset.type;render();});
$('home').addEventListener('click',()=>{state.gen++;document.body.classList.remove('searched');state.query='';state.refinement='';$('query').value='';window.scrollTo({top:0,behavior:'smooth'});});
