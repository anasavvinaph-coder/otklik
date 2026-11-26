// Pure, testable semantic ranking: no title, keyword, or string-match scores.
export const MODEL_ID = 'Xenova/multilingual-e5-small';
export const INDEX_VERSION = 1;
export function flattenFacets(catalog) {
  return (catalog.works || []).flatMap(work => (work.facets || []).map((facet, facetIndex) => ({
    id: work.id, facetIndex, text: `passage: ${facet.passage}`
  })));
}
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return -1;
  let dot=0, aa=0, bb=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]; }
  return aa && bb ? dot/Math.sqrt(aa*bb) : -1;
}
export function parseRefinement(refinement) {
  const r = String(refinement||'').toLowerCase().replaceAll('ё','е');
  let type=null;
  if(/(?:только|лишь|исключительно)\s*(?:книг|роман|литератур)|^(?:книг|роман|литератур)/.test(r))type='book';
  else if(/(?:только|лишь|исключительно)\s*(?:фильм|кино)|^(?:фильм|кино)/.test(r))type='film';
  else if(/(?:только|лишь|исключительно)\s*(?:картин|живопис)|^(?:картин|живопис)/.test(r))type='painting';
  // Do not pretend arbitrary sentiment restrictions have been understood.
  const semantic = r.replace(/(?:только|лишь|исключительно)\s*(?:книги|книг|романы|фильмы|фильм|кино|картины|картин|живопись|живопис)/g,'').trim();
  return {type,semantic};
}
export function rankWorks(catalog,index,queryVector,{type=null,limit=12}={}){
  const workMap=new Map((catalog.works||[]).map(w=>[w.id,w]));
  const strongest=new Map();
  for(const row of index.entries||[]){
    const work=workMap.get(row.id);
    if(!work || (type&&work.type!==type) || !work.facets[row.facetIndex])continue;
    const score=cosine(queryVector,row.vector);
    if(!Number.isFinite(score))continue;
    if(!strongest.has(row.id) || score>strongest.get(row.id).score){
      strongest.set(row.id,{...work,score,why:work.facets[row.facetIndex].why,facetIndex:row.facetIndex});
    }
  }
  const sorted=[...strongest.values()].sort((a,b)=>b.score-a.score);
  // Never fill the page with low-scoring, unrelated works just to reach a quota.
  const best=sorted[0]?.score ?? -1;
  if(best<0.68)return [];
  const relevant=sorted.filter(w=>w.score>=Math.max(0.68,best-0.075));
  if(type)return relevant.slice(0,limit);
  // Variety only after ranking by semantic similarity, not by keyword overlap.
  const result=[], counts={book:0,film:0,painting:0};
  for (const w of relevant){
    if(result.length===limit)break;
    if((counts[w.type]||0)>=Math.ceil(limit/2))continue;
    result.push(w);counts[w.type]=(counts[w.type]||0)+1;
  }
  return result;
}
export function makeQuery(query,refinement=''){
  const {semantic}=parseRefinement(refinement);
  return `query: ${String(query||'').trim()}${semantic?' Уточнение: '+semantic:''}`;
}
