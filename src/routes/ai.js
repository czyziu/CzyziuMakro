// src/routes/ai.js — SHIELD v2.4
// TOP-N (3/5) + fallback + diet normalize + robust hint sanitation
// + keep macro ranges on fallback + bundled variants for carousel

const express = require('express');
const { MongoClient } = require('mongodb');
let mongoose = null; try { mongoose = require('mongoose'); } catch {}

const router = express.Router();

// ───────────────────────────────────────────────────────────────────────────────
// Polyfills
const __hasFetch = (typeof fetch === 'function');
if (!__hasFetch) {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

// Config / Debug
const AI_DEBUG_DEFAULT = String(process.env.AI_DEBUG || '0') === '1';
const O_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const O_LLM  = process.env.OLLAMA_MODEL || 'llama3:instruct';
const LLM_OPTS = Object.freeze({ temperature: 0.2, top_p: 0.9, num_ctx: 8192 });

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const MONGO_DB  = process.env.MONGODB_DB || undefined;
const COL_MEALS = process.env.MONGODB_MEALS_COLLECTION || 'meals';
const COL_PRODS = process.env.MONGODB_PRODUCTS_COLLECTION || 'products';

let SHARED_FILTER = { isPublic: true };
try {
  if (process.env.MONGODB_SHARED_FILTER_JSON) SHARED_FILTER = JSON.parse(process.env.MONGODB_SHARED_FILTER_JSON);
} catch {}

// ───────────────────────────────────────────────────────────────────────────────
// Utils
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const N = (x,d=0)=>Number.isFinite(Number(x))?Number(x):d;
const numOrNull = (x)=> (x==null || Number.isNaN(Number(x)))?null:Number(x);
const rid = ()=> (Date.now().toString(36)+Math.random().toString(36).slice(2,7)).toUpperCase();
const j = (o)=>{try{return JSON.stringify(o);}catch{return String(o);}};
const MIN_SCALE = 0.15, MAX_SCALE = 6.0;

const oid = (x)=>{
  if(x==null)return null;
  if(typeof x==='string')return x;
  if(typeof x==='object'&&x.$oid)return String(x.$oid);
  if(typeof x.toHexString==='function')return x.toHexString();
  if(typeof x.toString==='function')return String(x.toString());
  return String(x);
};

// hashing (różnorodność)
function hash(s='') { let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }

// ── tekst: fold diacritics → lower → trim
const fold = (s='') => s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
const norm = (s='')=> fold(String(s)).toLowerCase().replace(/[^\p{L}\p{N}\s:%-]/gu,' ').replace(/\s+/g,' ').trim();

// stemming PL (prosty)
const STEM_ENDINGS = ['kami','ami','ach','ech','owa','owe','owi','owy','ego','owie','owej','ych','imi','ymi','em','om','ow','ek','ka','ki','ie','mi','u','y','i','a','e','o'];

// Stop-słowa — po foldzie (bez ogonków)
const STOP = new Set([
  'lub','albo','bez','z','i','oraz','prosze','poprosze','dla','mnie','na','do',
  'okolo','~','max','maks','maksymalnie','miedzy','pomiedzy','a',
  'min','minimum','co','najmniej','najwyzej','<=','>=','≤','≥'
]);

// słowa makro (po foldzie), rozpoznawane po słowie i stemie
const MACRO_BASE = new Set([
  'kcal','kal','kalorie',
  'bial','bialk','bialko','protein','p','b',
  'tluszcz','t','fat',
  'wegl','wegle','weglowodany','carb','carbs','w'
]);

// minimalna długość tokenu do ALL (poza grupami)
const MIN_ALL_LEN = 3;

const ascii = (s) => norm(s);

function plStemBasic(w){
  let t = ascii(w);
  for(const suf of STEM_ENDINGS){
    if(t.length> suf.length+2 && t.endsWith(suf)){ t=t.slice(0,-suf.length); break; }
  }
  return t;
}

// Rozbijanie słów z uwzględnieniem zakresów i zlepków cyfr-liter
function tokenizeWords(s=''){
  const fixed = ascii(s)
    .replace(/[–—-]/g, ' ')               // "20–40" / "20-40" → "20 40"
    .replace(/(\d)([a-z]+)/gi, '$1 $2');  // "1000kcal" → "1000 kcal"
  return fixed.split(' ').map(w=>w.replace(/[.,;:!?]/g,'')).filter(Boolean);
}

const isNumbery = (w) => /^\d+([.,]\d+)?$/.test(w);
const isMacroToken = (w, st) => MACRO_BASE.has(w) || MACRO_BASE.has(st);

// Szukajnik
function buildSearchIndex(meal, prodById){
  const name = ascii(meal.name||'');
  const ingNames = (meal.ingredients||[]).map(it=>{
    const pid=oid(it.productId??it.product??it.id??it._id);
    const p=prodById[pid];
    return ascii(p?.name||it.name||'');
  });
  const raw = (name+' '+ingNames.join(' ')).trim();
  const words = tokenizeWords(raw); const stems = words.filter(w=>!STOP.has(w)).map(plStemBasic);
  return { words, stems, raw };
}

// HINTY z promptu: all/avoid/anyGroups (X|Y)
function extractHints(s=''){
  const words = tokenizeWords(s);
  const stems = words.map(plStemBasic);

  const all=[], avoid=[], anyGroups=[];
  let i=0;
  while (i<stems.length){
    const w = words[i]; const st = stems[i];

    // liczby, makra i stop-słowa wywalamy
    if (isNumbery(w) || isMacroToken(w,st) || STOP.has(w)) { i++; continue; }

    // "bez X" → avoid (ale nie dla makr itd.)
    if (w==='bez' && stems[i+1]) {
      const nxtW = words[i+1], nxtS = stems[i+1];
      if (!isMacroToken(nxtW, nxtS) && !STOP.has(nxtW) && !isNumbery(nxtW)) avoid.push(nxtS);
      i+=2; continue;
    }

    // grupy X (lub|albo) Y — filtruj elementy grup z makr i liczb
    let group = []; let j=i; let touched=false;

    if (!isMacroToken(w,st) && !STOP.has(w) && !isNumbery(w)) { group.push(st); }

    j = i+1;
    while (j<stems.length && (words[j]==='lub'||words[j]==='albo')) {
      const nxtWord = words[j+1]; const nxtStem = stems[j+1];
      if (nxtStem) {
        if (!isMacroToken(nxtWord, nxtStem) && !STOP.has(nxtWord) && !isNumbery(nxtWord)) { group.push(nxtStem); touched=true; }
        j+=2;
      } else break;
    }
    if (touched && group.length>=1) { anyGroups.push(group); i=j; continue; }

    // „miedzy X a Y”
    if ((w==='miedzy'||w==='pomiedzy') && stems[i+1] && words[i+2]==='a' && stems[i+3]) {
      const aS=stems[i+1], bS=stems[i+3];
      const aW=words[i+1], bW=words[i+3];
      if (!isMacroToken(aW,aS) && !isNumbery(aW) && !STOP.has(aW) &&
          !isMacroToken(bW,bS) && !isNumbery(bW) && !STOP.has(bW)) {
        anyGroups.push([aS,bS]);
      }
      i+=4; continue;
    }

    // zwykłe ALL (pomijamy bardzo krótkie i makra)
    if (st && st.length>=MIN_ALL_LEN) all.push(st);
    i++;
  }

  const purge = (arr)=>
    [...new Set(arr.filter(t=> t && !isMacroToken(t,t) && !isNumbery(t) && t.length>=MIN_ALL_LEN ))];

  const purgeGroups = (groups)=>
    groups.map(g=>purge(g)).filter(g=>g.length>0);

  return { all: purge(all), avoid: purge(avoid), anyGroups: purgeGroups(anyGroups) };
}

// Parsowanie miękkich zakresów makro z promptu
function parseMacroRangesSoft(s=''){
  const t = norm(s);
  const out = { pMin:null,pMax:null,fMin:null,fMax:null,cMin:null,cMax:null };
  const setRange = (letter, min, max)=>{
    const key = letter==='p'?'p':letter==='f'?'f':'c';
    if (min!=null) out[key+'Min']=min;
    if (max!=null) out[key+'Max']=max;
  };
  // "białko 10-20", "p 10–20", "w 50-80"
  const reRange = /\b((?:bialk|bial|protein|p|b)|(?:tluszcz|fat|t)|(?:wegl|carb|w))\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\b/g;
  let m; while ((m=reRange.exec(t))) {
    const grp = m[1]; const a=Number(m[2]), b=Number(m[3]); const lo=Math.min(a,b), hi=Math.max(a,b);
    const letter = /^(?:bialk|bial|protein|p|b)$/.test(grp)?'p':/^(?:tluszcz|fat|t)$/.test(grp)?'f':'c';
    setRange(letter, lo, hi);
  }
  // "min 10 białka"
  const reMin = /\b(?:min|co najmniej|>=|≥)\s*(\d{1,3})\s*(?:g|gram(?:ow|y)?)?\s*((?:bialk|bial|p|b|protein)|(?:tluszcz|t|fat)|(?:wegl|w|carb))/g;
  while ((m=reMin.exec(t))) { const val=Number(m[1]); const grp=m[2]; const letter=/bialk|bial|p|b|protein/.test(grp)?'p':/tluszcz|t|fat/.test(grp)?'f':'c'; setRange(letter, val, null); }
  const reMax = /\b(?:max|do|<=|≤)\s*(\d{1,3})\s*(?:g|gram(?:ow|y)?)?\s*((?:bialk|bial|p|b|protein)|(?:tluszcz|t|fat)|(?:wegl|w|carb))/g;
  while ((m=reMax.exec(t))) { const val=Number(m[1]); const grp=m[2]; const letter=/bialk|bial|p|b|protein/.test(grp)?'p':/tluszcz|t|fat/.test(grp)?'f':'c'; setRange(letter, null, val); }
  return out;
}

function parseKcalSoft(s=''){
  const t = norm(s);
  const mTilde=t.match(/~\s*(\d{2,4})\s*kcal/);
  const mMax=t.match(/(?:max|do|<=|≤)\s*(\d{2,4})\s*kcal/);
  const mNum=t.match(/\b(\d{2,4})\s*kcal\b/);
  if (mTilde){ const x=Number(mTilde[1]); return {target:x, low:Math.round(x*0.9), high:Math.round(x*1.1)}; }
  if (mMax){ const x=Number(mMax[1]); return {target:null, low:null, high:x}; }
  if (mNum){ const x=Number(mNum[1]); return {target:x, low:null, high:null}; }
  return null;
}

// Alergie/zakazy miękkie
function parseAllergyAvoidSoft(s=''){
  const words = tokenizeWords(s); const stems = words.map(plStemBasic);
  const avoid=[]; for (let i=0;i<words.length;i++){
    if ((words[i]==='alergia'||words[i]==='uczulenie'||words[i]==='uczulony'||words[i]==='nie'||words[i]==='niejem')){
      if (stems[i+2] && words[i+1]==='na') avoid.push(stems[i+2]);
      else if (stems[i+1]) avoid.push(stems[i+1]);
    }
  }
  return avoid;
}

function readMacrosPer100(p){
  const kcal=N(p.kcal100??p.kcal??p?.macros?.kcal,0);
  const protein=N(p.p100??p.p??p.protein??p?.macros?.p,0);
  const fat=N(p.f100??p.f??p.fat??p?.macros?.f,0);
  const carbs=N(p.c100??p.c??p.carbs??p?.macros?.c,0);
  return {kcal,p:protein,f:fat,c:carbs};
}
function macrosOf(prodById,ingredients=[]){
  let out={kcal:0,p:0,f:0,c:0};
  for(const it of ingredients){
    const grams=N(it.grams,0);
    const pid=oid(it.productId??it.product??it.id??it._id);
    const p=prodById[pid];
    if(!p||grams<=0) continue;
    const m=readMacrosPer100(p);
    const r=grams/100.0;
    out.kcal+=m.kcal*r; out.p+=m.p*r; out.f+=m.f*r; out.c+=m.c*r;
  }
  return out;
}
function scaleIng(ingredients,scale){
  return (ingredients||[]).map(it=>({...it, grams:Math.max(0,Math.round(N(it.grams,0)*scale))}));
}

function remaining(dayTotals={},targets={}){
  const tp=targets.p??targets.protein;
  const tf=targets.f??targets.fat;
  const tc=targets.c??targets.carbs;
  return {
    kcal:Math.max(0,N(targets.kcal,0)-N(dayTotals.kcal,0)),
    p:Math.max(0,N(tp,0)-N(dayTotals.p,0)),
    f:Math.max(0,N(tf,0)-N(dayTotals.f,0)),
    c:Math.max(0,N(tc,0)-N(dayTotals.c,0))
  };
}

function inferTags(meal, prodById){
  const idx=buildSearchIndex(meal,prodById);
  const raw=idx.raw;
  const meat=/(kurcz|wol|woł|wieprz|szynk|kark|indyk|bocz|parow|kielb|schab|mieso|mięso)/i.test(raw);
  const dairy=/(ser|jogurt|mleko|twaro|smiet|śmiet|maslo|masło)/i.test(raw);
  const egg=/(jaj)/i.test(raw);
  const fish=/(loso|łoso|tunczy|tuńczy|sledz|śledź|makrel|pstrag|pstrąg|dorsz|ryb)/i.test(raw);
  return { meat, dairy, egg, fish };
}

// ───────────────────────────────────────────────────────────────────────────────
// DB load
let _mongoClient=null;
async function getMongoClient(){
  if(_mongoClient) return _mongoClient;
  _mongoClient=new MongoClient(MONGO_URI,{maxPoolSize:3});
  await _mongoClient.connect();
  return _mongoClient;
}
async function loadData(req,R){
  const mealsLocal=req?.app?.locals?.meals||req?.app?.locals?.MEALS;
  const productsLocal=req?.app?.locals?.products||req?.app?.locals?.PRODUCTS;
  if(Array.isArray(mealsLocal)&&mealsLocal.length&&Array.isArray(productsLocal)){
    const prodById=Object.fromEntries(productsLocal.map(p=>[oid(p._id??p.id),p]));
    console.log(`[${R}] using app.locals meals/products`);
    return {meals:mealsLocal, prodById};
  }

  if(mongoose?.connection?.readyState===1){
    let meals,prods;
    try{
      const Meals=mongoose.connection.models?.Meals||mongoose.connection.models?.Meal;
      const Products=mongoose.connection.models?.Products||mongoose.connection.models?.Product;
      if(!Meals||!Products) throw new Error('No Mongoose models Meal(s)/Product(s) registered');
      meals=await Meals.find(SHARED_FILTER).lean().exec();
      prods=await Products.find({}).lean().exec();
      console.log(`[${R}] using Mongoose models`);
    }catch(e){
      console.warn(`[${R}] mongoose models unavailable (${e.message}) → using native collections`);
      const db=mongoose.connection.db;
      meals=await db.collection(COL_MEALS).find(SHARED_FILTER).toArray();
      prods=await db.collection(COL_PRODS).find({}).toArray();
    }
    const prodById=Object.fromEntries((prods||[]).map(p=>[oid(p._id??p.id),p]));
    return {meals,prodById};
  }

  if(MONGO_URI){
    const cli=await getMongoClient();
    const db=MONGO_DB?cli.db(MONGO_DB):cli.db();
    const meals=await db.collection(COL_MEALS).find(SHARED_FILTER).toArray();
    const prods=await db.collection(COL_PRODS).find({}).toArray();
    const prodById=Object.fromEntries((prods||[]).map(p=>[oid(p._id??p.id),p]));
    console.log(`[${R}] using Mongo driver collections ${COL_MEALS}/${COL_PRODS}`);
    return {meals,prodById};
  }

  throw new Error('Brak źródła danych: app.locals / Mongoose / MONGO_URI');
}

// ───────────────────────────────────────────────────────────────────────────────
// Ollama (tylko parser intencji)
async function callOllamaJSON({ system, user, numPredict=384, dbg }, R){
  const payload={
    model:O_LLM, stream:false, format:'json',
    options:{...LLM_OPTS, temperature:0.2, num_predict:numPredict},
    messages:[{role:'system',content:system},{role:'user',content:user}]
  };
  dbg?.push({type:'ollama:req',model:O_LLM,options:payload.options,messages:payload.messages});
  try{
    const r = await fetch(`${O_HOST}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    if(!r.ok){
      const txt=await r.text().catch(()=>"" );
      dbg?.push({type:'ollama:http_error',status:r.status,body:String(txt).slice(0,400)});
      return null;
    }
    const data = await r.json().catch(()=>null);
    const raw = data?.message?.content || '{}';
    let parsed={}; try{ parsed=JSON.parse(raw);}catch{parsed={}; }
    dbg?.push({type:'ollama:resp',raw:String(raw).slice(0,4000),parsed});
    return parsed;
  }catch(e){
    dbg?.push({type:'ollama:exception',name:e?.name||'Error',message:e?.message||String(e)});
    return null;
  }
}
async function ollamaUnderstand(prompt,R,dbg){
  const system = `Jestes parserem intencji zywieniowych (PL). Zwroc TYLKO JSON wg schematu:
{
  "diet": "none|vegetarian|vegan|pescetarian|keto",
  "kcal": {"target": number|null, "low": number|null, "high": number|null},
  "macros": {
    "pMin": number|null, "pMax": number|null,
    "fMin": number|null, "fMax": number|null,
    "cMin": number|null, "cMax": number|null,
    "keepRatio": {"p": number|null, "f": number|null, "c": number|null}
  },
  "require": string[],
  "prefer":  string[],
  "avoid":   string[],
  "notes":   string[]
}
Reguly: "vege/wege"->"vegetarian"; "wegan*"->"vegan"; "ryby"->"pescetarian".
"~700 kcal" -> target=700, low=630, high=770. "max 1k kcal" -> high=1000.
"max 30 fatu"/"do 30 g tluszczu"-> macros.fMax=30. "dobij bialko do 40 g"-> macros.pMin=40.
"stosunek 2:1:1 W:B:T"-> keepRatio {c:2,p:1,f:1}. Rozpoznaj "z X", "bez X", "preferuj X".
Bez komentarzy.`;
  return callOllamaJSON({ system, user:String(prompt||''), numPredict:384, dbg }, R);
}

// ───────────────────────────────────────────────────────────────────────────────
// RANKING
function intersectScales(base, bounds){
  let lo = MIN_SCALE, hi = MAX_SCALE;
  const pushMin = (min, b) => { if (Number.isFinite(min) && min>0) { if (b>0) lo = Math.max(lo, min/b); else lo = Math.max(lo, MAX_SCALE); } };
  const pushMax = (max, b) => { if (Number.isFinite(max) && max>0) { if (b>0) hi = Math.min(hi, max/b); else hi = Math.min(hi, MIN_SCALE); } };
  pushMin(bounds.kMin, base.kcal); pushMax(bounds.kMax, base.kcal);
  pushMin(bounds.pMin, base.p);    pushMax(bounds.pMax, base.p);
  pushMin(bounds.fMin, base.f);    pushMax(bounds.fMax, base.f);
  pushMin(bounds.cMin, base.c);    pushMax(bounds.cMax, base.c);
  return { lo: Math.max(MIN_SCALE, lo), hi: Math.min(MAX_SCALE, hi) };
}

function matchHintsAndChoices(idx, {all,avoid,anyGroups}){
  const S = new Set(idx.stems);
  for (const a of all) if (!S.has(a)) return false;
  for (const x of avoid) if (S.has(x)) return false;
  for (const g of (anyGroups||[])) { let ok=false; for (const w of g) if (S.has(w)) { ok=true; break; } if (!ok) return false; }
  return true;
}

function rankMeals(meals, prodById, { intent, kcalGoal, rem, hints }){
  const bounds = {
    kMin: numOrNull(kcalGoal?.low),  kMax: numOrNull(kcalGoal?.high),
    pMin: numOrNull(intent?.macros?.pMin), pMax: numOrNull(intent?.macros?.pMax),
    fMin: numOrNull(intent?.macros?.fMin), fMax: numOrNull(intent?.macros?.fMax),
    cMin: numOrNull(intent?.macros?.cMin), cMax: numOrNull(intent?.macros?.cMax)
  };
  const wantK = N(intent?.kcal?.target ?? kcalGoal?.target ?? rem.kcal ?? 600, 600);

  function dietOk(m){
    const tg=inferTags(m,prodById);
    switch((intent?.diet||'none')){
      case 'vegan':       return !tg.meat && !tg.fish && !tg.dairy && !tg.egg;
      case 'vegetarian':  return !tg.meat && !tg.fish;
      case 'pescetarian': return !tg.meat;
      case 'keto':        return true;
      case 'none':
      default:            return true;
    }
  }

  const ranked=[];
  for (const m of meals){
    if(!dietOk(m)) continue;
    const idx=buildSearchIndex(m,prodById);
    if(!matchHintsAndChoices(idx,hints)) continue;

    const base=m.totals||macrosOf(prodById,m.ingredients);
    if(base.kcal<=0) continue;

    const {lo,hi} = intersectScales(base,bounds);
    if (lo>hi) continue; // nie da się spełnić zakresów

    let s = base.kcal>0? clamp(wantK/base.kcal, lo, hi) : lo;
    const tot = macrosOf(prodById, scaleIng(m.ingredients, s));

    // kara za łamanie ograniczeń
    let penalty = 0;
    if (Number.isFinite(bounds.kMax) && tot.kcal>bounds.kMax) penalty+= (tot.kcal-bounds.kMax)/10 + 1000;
    if (Number.isFinite(bounds.pMax) && tot.p>bounds.pMax)     penalty+= (tot.p-bounds.pMax) + 500;
    if (Number.isFinite(bounds.fMax) && tot.f>bounds.fMax)     penalty+= (tot.f-bounds.fMax) + 500;
    if (Number.isFinite(bounds.cMax) && tot.c>bounds.cMax)     penalty+= (tot.c-bounds.cMax) + 500;
    if (Number.isFinite(bounds.pMin) && tot.p<bounds.pMin)     penalty+= (bounds.pMin-tot.p)*2 + 200;
    if (Number.isFinite(bounds.fMin) && tot.f<bounds.fMin)     penalty+= (bounds.fMin-tot.f)*2 + 200;
    if (Number.isFinite(bounds.cMin) && tot.c<bounds.cMin)     penalty+= (bounds.cMin-tot.c)*2 + 200;

    const errK = Math.abs(tot.kcal - wantK)/Math.max(1,wantK);
    const score = penalty*1000 + errK*100 + (tot.f||0);
    ranked.push({ m, sc:s, tot, score });
  }
  ranked.sort((a,b)=>a.score-b.score);
  return ranked;
}

// ───────────────────────────────────────────────────────────────────────────────
// Dodatkowe helpery (normalize diet, relax)
function normalizeDiet(d){
  if(!d) return 'none';
  const s = String(d).toLowerCase();
  if (s.includes('|')) return 'none';
  if (/vega?n/.test(s)) return 'vegan';
  if (/veget|wega|wege/.test(s)) return 'vegetarian';
  if (/pesc/i.test(s) || /ryb/.test(s)) return 'pescetarian';
  if (/keto/.test(s)) return 'keto';
  return 'none';
}
function relaxMin(x){ return x==null?null:Math.max(0, Math.round(x*0.9)); }

// ───────────────────────────────────────────────────────────────────────────────
// Endpoint
router.post('/plan', express.json(), async (req,res)=>{
  const R = rid(); const WANT_DEBUG = AI_DEBUG_DEFAULT || String(req.query.debug||'0')==='1'; const DBG=[];
  try{
    const { prompt, dayTotals={}, targets={} } = req.body||{};
    // ile wariantów chcesz? (3 lub 5 sugerowane)
    const nReq = N(req.query.n || req.query.count || req.query.top || req.body?.n || req.body?.count || req.body?.top, 3);
    const N_VARIANTS = clamp(nReq, 1, 5);

    if(typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ error:'Brak pola "prompt" (string).' });
    console.log(`[${R}] [IN] prompt=${j(prompt)} dayTotals=${j(dayTotals)} targets=${j(targets)}`);

    const { meals, prodById } = await loadData(req,R);
    if(!meals.length) return res.status(500).json({ error:'Brak udostępnionych posiłków (isPublic:true).' });

    // diag
    let unresolved=0,totalIngs=0; for(const m of meals) for(const it of (m.ingredients||[])){ totalIngs++; const pid=oid(it.productId??it.product??it.id??it._id); if(!prodById[pid]) unresolved++; }
    console.log(`[${R}] [diag] meals=${meals.length} ingredients=${totalIngs} unresolved=${unresolved}`);

    const rem = remaining(dayTotals, targets);

    // 1) Zrozumienie intencji (LLM)
    let intent = await ollamaUnderstand(prompt,R,DBG) || {};
    intent = intent || {};
    intent.macros = intent.macros || {};
    intent.diet = normalizeDiet(intent?.diet);

    // 2) Miękkie parsowanie zakresów i alergii
    const kcalHint = parseKcalSoft(prompt);
    const macroRanges = parseMacroRangesSoft(prompt);
    const allergyAvoid = parseAllergyAvoidSoft(prompt);

    for (const k of ['pMin','pMax','fMin','fMax','cMin','cMax'])
      if (intent.macros[k]==null && macroRanges[k]!=null) intent.macros[k]=macroRanges[k];

    // kcal goal
    let kcalGoal = null;
    if (intent?.kcal && (intent.kcal.target!=null || intent.kcal.low!=null || intent.kcal.high!=null)) {
      kcalGoal = { target:numOrNull(intent.kcal.target), low:numOrNull(intent.kcal.low), high:numOrNull(intent.kcal.high) };
    } else if (kcalHint) {
      kcalGoal = { target:kcalHint.target, low:kcalHint.low, high:kcalHint.high };
    } else {
      const fb={ target: Math.min(1000, Math.max(400, rem.kcal||600)) };
      kcalGoal={ target:fb.target, low:Math.round(fb.target*0.9), high:Math.round(fb.target*1.1) };
    }

    // 3) HINTY (all/avoid/anyGroups) + alergie do avoid
    const hintsRaw = extractHints(prompt);
    const hints = {
      all: [...new Set(hintsRaw.all)],
      avoid: [...new Set([...(hintsRaw.avoid||[]), ...(allergyAvoid||[])])],
      anyGroups: hintsRaw.anyGroups||[]
    };

    // 4) RANKING (pełny → zrelaksowany → kcalOnlyHintRelax → ultra-light)
    const attempt = (hintSet, intentForAttempt) =>
      rankMeals(meals, prodById, {
        intent: intentForAttempt,
        kcalGoal,
        rem,
        hints: hintSet
      });

    // a) pełny
    let ranked = attempt(hints, intent);

    // b) zrelaksuj minima (10%) jeżeli nic nie ma
    if (!ranked.length) {
      const loose = JSON.parse(JSON.stringify(intent || {}));
      loose.macros = loose.macros || {};
      loose.macros.pMin = relaxMin(loose.macros.pMin);
      loose.macros.fMin = relaxMin(loose.macros.fMin);
      loose.macros.cMin = relaxMin(loose.macros.cMin);
      ranked = attempt(hints, loose);
    }

    // c) tylko luzuj hinty, ale **ZOSTAW** makra (kcalOnlyHintRelax)
    if (!ranked.length) {
      const hintsAvoidOnly = { all: [], avoid: hints.avoid || [], anyGroups: [] };
      ranked = attempt(hintsAvoidOnly, intent);
    }

    // d) ultra-light (ostatnia deska ratunku): weź najbliższe kcal
    if (!ranked.length) {
      const target = N(kcalGoal?.target ?? 600, 600);
      ranked = meals.map(m=>{
        const t=m.totals||macrosOf(prodById,m.ingredients);
        const sc=t.kcal>0?clamp(target/t.kcal,MIN_SCALE,MAX_SCALE):1;
        const tot=macrosOf(prodById,scaleIng(m.ingredients,sc));
        const err=Math.abs(tot.kcal-target)/Math.max(1,target);
        return { m, sc, tot, score: err };
      }).sort((a,b)=>a.score-b.score);
    }

    // 5) TOP-N propozycji (3 lub 5)
    const topN = ranked.slice(0, N_VARIANTS);
    if (!topN.length) return res.status(200).json({ error:'Brak propozycji (pusty ranking).' });

    // seed do domyślnego wyboru (powtarzalny w ciągu dnia)
    const seed = hash(String(prompt)+'|'+new Date().toISOString().slice(0,10));
    const pickIndex = seed % topN.length;
    const choice = topN[pickIndex];

    // Przygotuj pełne warianty do karuzeli (z przeskalowanymi składnikami)
    const defaultSteps = [
      'Przygotuj składniki i rozgrzej patelnię/garnek.',
      'Podsmaż/ugotuj według uznania do miękkości.',
      'Dopraw solą, pieprzem i ulubionymi przyprawami.',
      'Podaj od razu po przygotowaniu.'
    ];

    const variants = topN.map(x=>{
      const scaledIngs = scaleIng(x.m.ingredients, x.sc).map(it=>({
        productId: oid(it.productId??it.product??it.id??it._id),
        name:  (prodById[oid(it.productId??it.product??it.id??it._id)]?.name) || it.name || 'Produkt',
        grams: it.grams
      }));
      return {
        mealId: String(x.m.id ?? oid(x.m._id)),
        title: x.m.name,
        scale: +x.sc.toFixed(3),
        totals: { kcal: Math.round(x.tot.kcal), p: Math.round(x.tot.p), f: Math.round(x.tot.f), c: Math.round(x.tot.c) },
        timeMinutes: Math.max(1, Math.round(N(x.m.timeMinutes, 15))),
        servings: Math.max(1, Math.round(N(x.m.servings ?? x.m.portions, 1))),
        ingredients: scaledIngs,
        steps: (Array.isArray(x.m.steps)&&x.m.steps.length)? x.m.steps : defaultSteps
      };
    });

    // „picked” dla wstecznej kompatybilności (to co dotychczasowy front oczekuje)
    const picked = variants[pickIndex];

    // Lekkie options (bez składników) — jak wcześniej
    const options = variants.map(v => ({
      mealId: v.mealId,
      title: v.title,
      scale: v.scale,
      totals: v.totals
    }));

    // Wyjście
    const out = {
      // główna propozycja (pod stary UI)
      mealId: picked.mealId,
      title: picked.title,
      timeMinutes: picked.timeMinutes,
      servings: picked.servings,
      targetKcal: N(kcalGoal?.target ?? 0, 0),
      ingredients: picked.ingredients,
      steps: picked.steps,
      note: `SHIELD · seed=${pickIndex+1}/${topN.length}`,
      totals: picked.totals,
      options,              // lekka lista
      variants,             // pełne warianty do karuzeli
      selectedIndex: pickIndex
    };

    if (WANT_DEBUG) {
      out.debug = {
        requestId: R,
        req: { prompt, dayTotals, targets, n: N_VARIANTS },
        intent, kcalGoal,
        hints,
        topPreview: ranked.slice(0,Math.min(8, ranked.length)).map(x=>({
          name:x.m.name, sc:+x.sc.toFixed(3), kcal:+x.tot.kcal.toFixed(0),
          p:+x.tot.p.toFixed(0), f:+x.tot.f.toFixed(0), c:+x.tot.c.toFixed(0),
          score:+x.score.toFixed(3)
        })),
        ollama: (Array.isArray(DBG)&&DBG.length)?DBG:undefined
      };
    }

    return res.json(out);
  }catch(err){
    console.error(`[${rid()}] [AI/plan] ERROR`, err);
    return res.status(500).json({ error:'Błąd serwera planowania AI', details:String(err?.message||err) });
  }
});

// Healthcheck (prosty)
router.get('/health', async (_req,res)=>{
  let mongo='disabled';
  try{
    if(mongoose?.connection?.readyState===1){
      await mongoose.connection.db.admin().ping(); mongo='mongoose';
    } else if (MONGO_URI){
      const cli=await getMongoClient(); const db=MONGO_DB?cli.db(MONGO_DB):cli.db();
      await db.command({ ping:1 }); mongo='driver';
    }
  }catch(e){ mongo='error'; }
  res.json({ ok:true, model:O_LLM, host:O_HOST, mongo });
});

module.exports = router;
