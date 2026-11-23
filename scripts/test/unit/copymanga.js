const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {archiveSource, source, candidates, diskCache} = require('../../reading/copymanga.js');

test('chapter links from desktop and mobile agree', () => {
	const result = {slug:'book', id:'chapter-1'};
	assert.deepEqual(source('https://www.mangacopy.com/comic/book/chapter/chapter-1'), result);
	assert.deepEqual(source('https://copymanga.tv/h5/comicContent/book/chapter-1?q=1'), result);
	assert.equal(source('https://www.mangacopy.com.example.org/comic/book/chapter/chapter-1'), null);
	assert.equal(source('https://www.mangacopy.com/comic/book').id, null);
});

test('read only a valid ZIP end comment and preserve per-chapter cached pages', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-copy-'));
	t.after(() => fs.rm(dir, {recursive:true,force:true}));
	const file = path.join(dir, 'renamed.cbz');
	const comment = Buffer.from('https://www.mangacopy.com/comic/book/chapter/abc');
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(comment.length,20);
	await fs.writeFile(file,Buffer.concat([Buffer.alloc(70000),end,comment]));
	assert.deepEqual(await archiveSource(file), {slug:'book',id:'abc'});
	await fs.appendFile(file,'junk');
	assert.equal(await archiveSource(file),null);
	const store = diskCache(dir);
	store.set('abc:0',{list:['text']});
	assert.deepEqual(diskCache(dir).get('abc:0'),{list:['text']});
	assert.equal(store.get('xyz:0'),null);
});

test('legacy Colab names retain ambiguous groups and distinguish side stories', () => {
	const chapters = [{name:'第1話', group:'連載'}, {name:'第1話', group:'重製'}, {name:'第01話 番外'}, {name:'第1卷'}, {name:'第11話'}];
	assert.deepEqual(candidates('作品 - 第01话 - 拷貝漫畫 拷贝漫画-OpenComic-2x-deadbeef.cbz',chapters),chapters.slice(0,2));
	assert.deepEqual(candidates('作品 第01话 番外',chapters),[chapters[2]]);
	assert.deepEqual(candidates('第01卷.zip',chapters),[chapters[3]]);
	assert.deepEqual(candidates('第2話',chapters),[]);
});

test('history import picks the latest actual reading per book and skips unresolved files', async () => {
	const {latestRecords} = require('../../reading/copymanga-history.js');
	const folder = path.resolve('MyBook');
	const first = path.join(folder, '第1话'), second = path.join(folder, '第2话');
	const ambiguous = path.join(folder, '番外');
	const book = {slug:'book',chapters:[{id:'a',name:'第1話'},{id:'b',name:'第2話'},{id:'c',name:'番外'},{id:'d',name:'番外'}]};
	const storage = {get:key => key === 'book:'+folder ? book : null};
	const rows = [first, second, second, ambiguous].map((file,i) => ({path:path.join(file,'page.png'),index:i+1,lastReading:10+i}));
	assert.deepEqual(await latestRecords(rows,storage,path.dirname),[{slug:'book',id:'b',page:3,recordedAt:12,historical:true}]);
});
