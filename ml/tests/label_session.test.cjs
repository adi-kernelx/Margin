// Execute the actual inline script without a DOM: no browser/UI automation.
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = readFileSync(join(__dirname, '../labels/label.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const context = vm.createContext({});
new vm.Script(code).runInContext(context);
const api = context.LabelSession;
const input = [1,2,3].map(n => ({block_id:`b${n}`,file:'sample.pdf',page:n,text:'Some mathematical text.'}));
const rows = () => api.sample(input.map(row => JSON.stringify(row)).join('\n'));

test('parse sample strips weak labels and accepts BOM/CRLF', () => {
  const parsed = api.sample('\uFEFF' + JSON.stringify({...input[0],weak_label:'proof',stratum:'weak'}) + '\r\n');
  assert.equal(JSON.stringify(Object.keys(parsed[0])), JSON.stringify(['block_id','file','page','text']));
});
test('reject malformed, empty, duplicate or invalid sample', () => {
  for (const value of ['', '{', 'null', JSON.stringify({...input[0],page:0}),
                       [input[0],input[0]].map(row => JSON.stringify(row)).join('\n')]) {
    assert.throws(() => api.sample(value));
  }
});
test('label, back/edit, skip and final block stay in bounds', () => {
  const state = api.create(rows());
  api.answer(state,'definition','2026-10-06T00:00:00Z');
  assert.equal(state.index,1); state.index = 0;
  api.answer(state,'theorem'); assert.equal(state.answers.size,1);
  state.index = 0; api.skip(state); assert.equal(state.answers.size,0);
  assert.equal(state.skipped.has('b1'),true);
  state.index = 2; api.answer(state,'proof'); assert.equal(state.index,2);
  assert.throws(() => api.answer(state,'invalid'));
});
test('storage snapshot round trips with labels, skipped and position', () => {
  const state = api.create(rows()); api.answer(state,'definition'); api.skip(state);
  const restored = api.create(rows()); api.restore(restored,api.snapshot(state));
  assert.equal(api.snapshot(restored),api.snapshot(state));
});
test('changed dataset cannot restore old progress', () => {
  const state = api.create(rows()), changed = rows(); changed[0].text = 'Changed text.';
  assert.notEqual(api.key(state.rows),api.key(changed));
  assert.throws(() => api.restore(api.create(changed),api.snapshot(state)));
});
test('export contains only labelled IDs and valid schema; import validates atomically', () => {
  const state = api.create(rows()); api.answer(state,'definition'); api.skip(state);
  const text = api.exported(state), exported = JSON.parse(text);
  assert.equal(JSON.stringify(Object.keys(exported)),JSON.stringify(['block_id','label','labelled_at']));
  assert.equal(api.imported(text,rows()).length,1);
  for (const bad of [{...exported,block_id:'foreign'}, {...exported,label:'invalid'}, {...exported,labelled_at:'bad'}]) {
    assert.throws(() => api.imported(text + '\n' + JSON.stringify(bad),rows()));
  }
  assert.throws(() => api.imported(text + '\n' + text,rows()));
});
test('invalid cached progress is rejected without state mutation', () => {
  const state = api.create(rows()), before = api.snapshot(state);
  for (const data of [{...JSON.parse(before),index:99}, {...JSON.parse(before),skipped:['foreign']}]) {
    assert.throws(() => api.restore(state,JSON.stringify(data)));
    assert.equal(api.snapshot(state),before);
  }
});
