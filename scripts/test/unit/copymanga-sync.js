const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createQueue, confirmChapter} = require('../../copymanga-sync.js');
const ok = {signedIn:true,state:'synced'};

test('success requires the latest website history to match the requested chapter', async () => {
	const desired = {slug:'book',id:'next'};
	let visits = 0;
	const visit = async () => { visits++; };
	const replies = ['old','old','next'];
	const read = async () => ({signedIn:true,id:replies.shift()});
	assert.deepEqual(await confirmChapter(desired,read,visit,async () => {}),ok);
	assert.equal(visits,1);
	await assert.rejects(confirmChapter(desired,async () => ({signedIn:true,id:null}),visit,async () => {}),/尚未确认/);
	assert.equal(visits,2);
});

test('imports keep existing remote history and signed-out sessions never visit a chapter', async () => {
	const desired = {slug:'book',id:'past',historical:true};
	const visit = () => assert.fail('unexpected chapter visit');
	assert.equal((await confirmChapter(desired,async () => ({signedIn:true,id:'other'}),visit)).conflict,true);
	assert.equal((await confirmChapter(desired,async () => ({signedIn:true,id:'past'}),visit)).state,'synced');
	assert.equal((await confirmChapter(desired,async () => ({signedIn:false}),visit)).state,'signed-out');
});

test('rapidly changing chapters uploads the latest after the in-flight request', async () => {
	const calls = [];
	let release;
	const queue = createQueue(async ({id}) => {
		calls.push(id);
		if(id === 'first') await new Promise(done => {release = done;});
		return ok;
	});
	const one = queue.sync({slug:'book',id:'first',recordedAt:1});
	const two = queue.sync({slug:'book',id:'second',recordedAt:2});
	const three = queue.sync({slug:'book',id:'third',recordedAt:3});
	const same = queue.sync({slug:'book',id:'third',recordedAt:4});
	assert.equal(queue.status('book','third').state, 'pending');
	release();
	assert.equal((await one).state,'ready');
	assert.equal((await two).state,'ready');
	assert.deepEqual(await three,ok);
	assert.deepEqual(await same,ok);
	assert.deepEqual(calls,['first','third']);
	const history = await queue.sync({slug:'book',id:'second',historical:true,recordedAt:2});
	assert.equal(history.state,'ready');
	assert.deepEqual(calls,['first','third']);
});

test('failed progress retries, confirmed progress is deduplicated, sign-out cancels work', async () => {
	let calls = 0;
	const queue = createQueue(async ({id},signal) => {
		calls++;
		if(calls === 1) throw new Error('失败');
		if(id === 'later') await new Promise(done => signal.addEventListener('abort',done,{once:true}));
		return ok;
	});
	const request = {slug:'book',id:'read'};
	assert.equal((await queue.sync(request)).state,'error');
	assert.deepEqual(await queue.sync(request),ok);
	assert.deepEqual(await queue.sync(request),ok);
	assert.equal(calls,2);
	const inFlight = queue.sync({...request,id:'later'});
	queue.close();
	assert.deepEqual(await inFlight,{signedIn:false,state:'signed-out'});
});
