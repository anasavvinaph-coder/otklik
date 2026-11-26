// Live, federated discovery over openly documented public catalogs.
// This module RETRIEVES candidates; it does not assert their thematic relevance.
// Semantic ranking takes place separately, using the work descriptions.

export const LIVE_SOURCES = ['Open Library', 'Wikipedia', 'Art Institute of Chicago'];

export function fold(value) {
  return String(value ?? '').toLowerCase().replaceAll('ё','е').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/[^a-zа-я0-9]+/gi,' ').trim();
}
const STOP = new Set('что такое зачем почему как кто где когда с чего мне меня мой моя мои мои у меня если может быть люди человек что означает про дай покажи найти хочу книги фильм картины произведения об обы в на у о по из и или же не жизнь жизни в нашей современном сегодня'.split(' '));
export function conceptFromQuestion(question){
  const words = fold(question).split(/\s+/).filter(w=>w.length>2&&!STOP.has(w));
  return words.slice(0,5).join(' ') || fold(question);
}

// A lightweight, extensible dictionary helps the public catalogs find works that
// discuss a theme under a different language. It is NOT used to rank works.
const BRIDGES = [
  [/совест|виноват|морал|нравствен|долг|ответственност/i,['conscience','guilt moral responsibility']],
  [/свобод|несвобод|выбор|воля/i,['freedom','personal freedom choice']],
  [/одиноч|одиноко|покинут/i,['loneliness','alienation isolation']],
  [/тупик|застр|потерял себя|смысл жизни|не знаю куда/i,['existential crisis','meaning of life']],
  [/любов|влюбл|отношени/i,['love','romantic relationships']],
  [/предател|обман|ложь/i,['betrayal','deception']],
  [/париж/i,['Paris','Paris city']],
  [/справедлив|неравенств/i,['justice','injustice']],
  [/страх|тревог|бояться/i,['fear','anxiety']],
  [/смерт|смерти|утрат/i,['mortality','grief']],
  [/детств|взрослен/i,['childhood','coming of age']],
  [/завист|ревност/i,['jealousy','envy']],
  [/власть|тирания/i,['power','tyranny']],
  [/счасть|радост/i,['happiness','happiness in life']],
  [/прощен|простить/i,['forgiveness','redemption']],
  [/войн|пацифиз/i,['war','anti-war']],
  [/семь|родител|дети/i,['family','family relationships']],
  [/идентичност|кто я|самоидентиф/i,['identity','self discovery']],
  [/религи|вера|бог/i,['faith','religious belief']],
  [/индия/i,['India','India culture']],
];
export function seedTerms(question){
  const q=String(question||'');
  for(const [regex,terms] of BRIDGES)if(regex.test(q))return terms;
  return /[a-z]/i.test(q)?[conceptFromQuestion(q)]:[];
}
export async function requestJson(url,{fetchImpl=fetch,timeout=9000}={}){
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`Источник не отвечает: HTTP ${response.status}`);
    return response.json();
  }finally{clearTimeout(timer);}
}

export function validCover(doc){return Number.isSafeInteger(doc?.cover_i)&&doc.cover_i>0;}
export function extractDescription(data){
  const desc=data?.description;
  return typeof desc==='string'?desc:typeof desc?.value==='string'?desc.value:'';
}
export function usefulExcerpt(text){
  const normalized=String(text||'').replace(/\[[^\]]{1,50}\]/g,'').replace(/\s+/g,' ').trim();
  if(!normalized)return '';
  // Prefer concrete story or visual content, instead of catalog metadata.
  const sentences=normalized.match(/[^.!?。]+[.!?。]?/g)||[];
  const candidates=sentences.map(s=>s.trim()).filter(s=>s.length>=48 && s.length<=420);
  const strong=candidates.find(s=>/character|story|follows|explor|struggl|confront|challeng|conflict|grappl|relationship|hero|narrat|depict|portray|life|судьб|геро|истори|конфликт|борьб|изобража|рассказыва|исследу/i.test(s));
  return (strong||candidates[1]||candidates[0]||normalized).slice(0,390);
}

function mapOpenLibraryDoc(d,description){
  const key=/^\/works\/OL\d+W$/.test(d.key||'')?d.key:null;
  if(!key||!d.title || !(d.author_name||[]).length)return null;
  const synopsis=description?.trim()||'';
  if(synopsis.length<65)return null; // No plot -> no meaningful semantic evidence.
  const snippet=usefulExcerpt(synopsis);
  if(snippet.length<48)return null;
  return {
    id:'ol-'+key.split('/').pop(),type:'book',title:d.title,creator:d.author_name[0]||'',year:d.first_publish_year||'',
    url:'https://openlibrary.org'+key,image:validCover(d)?`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`:'',
    summary:synopsis.slice(0,1500),evidence:snippet,source:'Open Library',
  };
}

export async function discoverBooks(term,{fetchImpl=fetch,limit=14}={}){
  if(!term)return [];
  const u=new URL('https://openlibrary.org/search.json');
  u.search=new URLSearchParams({q:term,fields:'key,title,author_name,first_publish_year,cover_i,subject,first_sentence',limit:String(Math.max(20,limit*3))}).toString();
  const data=await requestJson(u.href,{fetchImpl});
  const docs=(data.docs||[]).filter(d=>d.key?.startsWith('/works/')&&d.title&&d.author_name?.length).slice(0,limit);
  const result=[];let cursor=0;
  async function work(){
    while(cursor<docs.length && result.length<limit){
      const d=docs[cursor++];
      let desc='';
      try{const details=await requestJson('https://openlibrary.org'+d.key+'.json',{fetchImpl,timeout:6500});desc=extractDescription(details)}catch(_){}
      if(!desc){const first=d.first_sentence;desc=Array.isArray(first)?first[0]:typeof first==='string'?first:'';}
      const mapped=mapOpenLibraryDoc(d,desc);
      if(mapped)result.push(mapped);
    }
  }
  await Promise.all(Array.from({length:3},work));
  return result.slice(0,limit);
}

const PATTERNS = {
  film:/\b(film|movie|motion picture|кин[оа]|фильм)\b/i,
  painting:/\b(painting|paintings|canvas|oil-on|oil on|холст|картин|живопис)\b/i,
  book:/\b(novel|novella|literary fiction|fictional novel|book|роман|книг|повест)\b/i,
};
export function classifyWikiPage(page,desired){
  const text=(page?.extract||'').slice(0,550);
  if(text.length<100)return false;
  if(/^(list of|список|index of|category:)/i.test(String(page?.title||'')))return false;
  // These are loose retrieval filters; later semantic ranking uses the text itself.
  const prefix=text.slice(0,240);
  if(!PATTERNS[desired].test(prefix))return false;
  if(desired==='film'&&/film festival|film school|film director|фестиваль|режиссер|film production company/i.test(prefix))return false;
  if(desired==='painting'&&/painting technique|painting movement|painting school|art history|style of painting/i.test(prefix))return false;
  if(desired==='book'&&/book series|book publisher|books by/i.test(prefix))return false;
  return true;
}
function pageToWork(page,desired,lang){
  if(!classifyWikiPage(page,desired))return null;
  const synopsis=(page.extract||'').replace(/\s+/g,' ').trim();
  const evidence=usefulExcerpt(synopsis);
  if(evidence.length<48)return null;
  const yearMatch=synopsis.slice(0,220).match(/(?:18|19|20)\d{2}/);
  const creatorMatch=synopsis.slice(0,320).match(/(?:directed by|written by|painting by|painted by|novel by|by the painter|режисс[её]ра|художника)\s+([^.,;(]{5,70})/i);
  return {
    id:`wiki-${lang}-${page.pageid}`,type:desired,title:page.title,creator:creatorMatch?.[1]?.trim()||'',year:yearMatch?.[0]||'',
    url:page.fullurl||`https://${lang}.wikipedia.org/?curid=${page.pageid}`,
    image:page.thumbnail?.source?.startsWith('https://')?page.thumbnail.source:'',
    summary:synopsis.slice(0,1850),evidence,source:'Wikipedia',
  };
}
export async function discoverWikipedia(term,desired,{fetchImpl=fetch,lang='en',limit=15}={}){
  if(!term)return [];
  const category=desired==='film'?(lang==='ru'?'фильм':'film'):
    desired==='painting'?(lang==='ru'?'картина':'painting'):(lang==='ru'?'роман':'novel');
  const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:`${term} ${category}`,gsrlimit:String(limit),gsrnamespace:'0',prop:'extracts|pageimages|info',
    exintro:'1',explaintext:'1',exchars:'2300',inprop:'url',piprop:'thumbnail',pithumbsize:'680',format:'json',formatversion:'2',origin:'*'});
  const data=await requestJson(`https://${lang}.wikipedia.org/w/api.php?${params}`,{fetchImpl});
  const pages=data.query?.pages||[];
  return pages.map(p=>pageToWork(p,desired,lang)).filter(Boolean).slice(0,limit);
}

// The Art Institute of Chicago provides open art metadata and IIIF images.
// We deliberately require a meaningful public description/alt text; a title
// and a few keywords alone cannot establish a philosophical connection.
export async function discoverChicago(term,{fetchImpl=fetch,limit=13}={}){
  if(!term)return [];
  const params=new URLSearchParams({q:term,limit:String(limit),fields:'id,title,artist_display,date_display,image_id,is_public_domain,artwork_type_title,description,thumbnail,subject_titles'});
  const data=await requestJson('https://api.artic.edu/api/v1/artworks/search?'+params,{fetchImpl});
  return (data.data||[]).flatMap(row=>{
    const kind=String(row.artwork_type_title||'');
    if(!/painting|print|drawing|illustration/i.test(kind))return [];
    const alt=String(row.thumbnail?.alt_text||'');
    const description=String(row.description||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const summary=(description.length>100?description:alt);
    if(summary.length<90)return [];
    return [{id:'aic-'+row.id,type:'painting',title:row.title,creator:row.artist_display||'',year:row.date_display||'',
      url:`https://www.artic.edu/artworks/${row.id}`,
      image:row.is_public_domain&&row.image_id?`https://www.artic.edu/iiif/2/${row.image_id}/full/600,/0/default.jpg`:'',
      summary:summary.slice(0,1750),evidence:usefulExcerpt(summary),source:'Art Institute of Chicago'}];
  });
}

export async function resolveTopic(question,{fetchImpl=fetch}={}){
  const preferred=seedTerms(question);
  if(preferred.length)return {terms:preferred,lang:'en',origin:'seed'};
  const concept=conceptFromQuestion(question);
  if(/[a-z]/i.test(concept)&&!/[а-яё]/i.test(concept))return {terms:[concept],lang:'en',origin:'literal'};
  // Wikipedia provides language links for arbitrary Russian subjects at no charge.
  try{
    const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:concept,gsrnamespace:'0',gsrlimit:'3',prop:'langlinks',lllang:'en',format:'json',formatversion:'2',origin:'*'});
    const data=await requestJson('https://ru.wikipedia.org/w/api.php?'+params,{fetchImpl,timeout:6500});
    const pages=data.query?.pages||[];
    const translated=pages.find(p=>p.langlinks?.length);
    if(translated)return {terms:[translated.langlinks[0].title],lang:'en',origin:'wikipedia'};
  }catch(_){}
  return {terms:[concept],lang:'ru',origin:'russian'};
}

export function deduplicate(items){
  const seen=new Set();return items.filter(x=>{
    const key=x.type+'|'+fold(x.title);
    if(!x.title||seen.has(key))return false;
    seen.add(key);return true;
  });
}

// Never call a general web search a trustworthy, complete index of the web.
export async function discoverLive(question,{fetchImpl=fetch,onProgress=()=>{}}={}){
  const topic=await resolveTopic(question,{fetchImpl});
  onProgress(`Обращаемся к открытым каталогам по теме «${topic.terms[0]}»…`);
  const terms=[...new Set(topic.terms)].slice(0,2);
  const jobs=[];
  for(const term of terms){
    jobs.push(discoverBooks(term,{fetchImpl,limit:10}));
    jobs.push(discoverChicago(term,{fetchImpl,limit:13}));
    for(const category of ['film','painting']){
      jobs.push(discoverWikipedia(term,category,{fetchImpl,lang:topic.lang,limit:13}));
    }
    jobs.push(discoverWikipedia(term,'book',{fetchImpl,lang:topic.lang,limit:8}));
  }
  // Never discard healthy providers due to an outage in another provider.
  const settled=await Promise.allSettled(jobs);
  const failed=settled.filter(x=>x.status==='rejected').length;
  const items=deduplicate(settled.flatMap(x=>x.status==='fulfilled'?x.value:[]));
  return {items,requested:jobs.length,failed,topic:topic.terms[0],providers:LIVE_SOURCES};
}

export function buildCandidatePassage(item){
 return `passage: ${String(item.summary||'').slice(0,1600)}`;
}
export function evidenceWhy(item){
 // Do not hallucinate plot or claim this automatically produced a critical reading.
 return `Возможная связь с вопросом — в сюжете или образе произведения: ${item.evidence||item.summary||''}`;
}
