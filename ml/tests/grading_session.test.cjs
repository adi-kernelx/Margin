// Run the actual inline script in a VM; no browser/UI automation.
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const html=readFileSync(join(__dirname,'../eval/grading.html'),'utf8');
const context=vm.createContext({crypto:webcrypto,TextEncoder});
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]).runInContext(context);
const api=vm.runInContext('GradingSession',context);
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function packet(){
 const records=[true,false].map((answerable,i)=>({id:`A00${i+1}`,question:'Synthetic question é',source_file:'toy.pdf',answer:'Synthetic answer',answerable,answer_pages:answerable?[1]:[],answer_quote:answerable?'Evidence':'',contexts:[{text:'Supplied context',page:1,kind:'passage'}]}));
 return {version:1,packet_id:createHash('sha256').update(JSON.stringify(canonical(records))).digest('hex'),records};
}
const rating=(id='A001')=>({id,correctness:2,grounding:2,abstained:false,correct_abstention:null,notes:''});

test('packet hash matches canonical UTF-8 JSON; modified content is rejected',async()=>{
 const p=api.packet(JSON.stringify(packet()));await api.verify(p);
 p.records[0].answer='Changed';await assert.rejects(()=>api.verify(p));
});
test('reject malformed, empty, duplicate and non-blinded packets',()=>{
 const cases=['','null','{}'];
 const duplicate=packet();duplicate.records.push(duplicate.records[0]);cases.push(JSON.stringify(duplicate));
 const secret=packet();secret.records[0].method='ranker_full';cases.push(JSON.stringify(secret));
 const score=packet();score.records[0].contexts[0].cross_encoder=1;cases.push(JSON.stringify(score));
 for(const text of cases)assert.throws(()=>api.packet(text));
});
test('empty choices, booleans as scores and contradictory abstentions are invalid',()=>{
 const p=packet();api.validate(rating(),p.records[0]);
 for(const r of [{...rating(),correctness:null},{...rating(),correctness:true},{...rating(),abstained:true},{...rating('A002'),correct_abstention:true}])assert.throws(()=>api.validate(r,r.id==='A002'?p.records[1]:p.records[0]));
 api.validate({...rating('A002'),abstained:true,correct_abstention:true},p.records[1]);
 assert.throws(()=>api.validate({...rating('A002'),correct_abstention:false},p.records[1]));
});
test('partial backups restore; changed packet and duplicate imports fail atomically',()=>{
 const p=packet(),s=api.create(p);s.ratings.set('A001',rating());
 const backup=api.exported(s),restored=api.imported(backup,p);assert.equal(restored.size,1);
 assert.equal(JSON.parse(backup).ratings[0].id,'A001');
 for(const bad of [{...JSON.parse(backup),packet_id:'changed'}, {...JSON.parse(backup),ratings:[rating(),rating()]}])assert.throws(()=>api.imported(JSON.stringify(bad),p));
 assert.equal(s.ratings.size,1);
});
test('drafts are not counted or exported as completed judgments',()=>{
 const s=api.create(packet());s.drafts.set('A001',{correctness:1});
 assert.equal(JSON.parse(api.exported(s)).ratings.length,0);
});
test('offline viewer renders untrusted text without HTML injection or network code',()=>{
 assert.ok(html.includes("connect-src 'none'"));
 assert.ok(!html.includes('.innerHTML')&&!html.includes('fetch('));
 assert.ok(html.includes('textContent=')&&html.includes('role="alert"'));
});
