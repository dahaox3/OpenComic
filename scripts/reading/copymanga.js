const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const {createHash, randomUUID} = require('node:crypto');

const hosts = new Set(['mangacopy.com', 'copymanga.tv', 'copymanga.site', 'copy4000.com']);
const headers = {catalog: {'User-Agent': 'Mozilla/5.0', 'x-requested-with': 'com.manga2020.app', platform: '3', version: '2024.4.28', webp: '1', Referer: 'https://www.mangacopy.com/'},
	comments: {'User-Agent': 'COPY/3.0.0', source: 'copyApp', region: '1', webp: '1', version: '3.1.1', Referer: 'com.copymanga.app-3.0.0'}};

function source(value)
{
	try {
		const url = new URL(value);
		if(url.protocol !== 'https:' || !hosts.has(url.hostname.replace(/^www\./, ''))) return null;
		const match = /^\/(?:comic\/([\w-]+)(?:\/chapter\/([\w-]+))?|h5\/details\/comic\/([\w-]+)|h5\/comicContent\/([\w-]+)\/([\w-]+))\/?$/.exec(url.pathname);
		return match ? {slug: match[1] || match[3] || match[4], id: match[2] || match[5] || null} : null;
	} catch { return null; }
}

// ZIP64 archives also end in a classic EOCD record. Only read its bounded tail.
async function archiveSource(file)
{
	const handle = await fs.promises.open(file, 'r');
	try {
		const {size} = await handle.stat();
		const tail = Buffer.alloc(Math.min(size, 65535 + 22));
		await handle.read(tail, 0, tail.length, size - tail.length);
		for(let i = tail.length - 22; i >= 0; i--) {
			if(tail.readUInt32LE(i) !== 0x06054b50 || i + 22 + tail.readUInt16LE(i + 20) !== tail.length) continue;
			const result = source(tail.toString('utf8', i + 22));
			if(result?.id) return result;
		}
		return null;
	} finally { await handle.close(); }
}

function normalize(title)
{
	return title.normalize('NFKC').toLowerCase().replace(/話/g, '话')
		.replace(/番外篇/g, '番外').replace(/\d+/g, n => n.replace(/^0+(?=\d)/, '')).replace(/\s/g, '');
}

function candidates(filename, chapters)
{
	const name = normalize(filename.replace(/\.(cbz|zip)$/i, '').replace(/-OpenComic-2x-[\da-f]{8}$/i, ''));
	const parts = name.replace(/[-–—]拷[貝贝]漫[畫画].*$/, '').split(/[-–—]/);
	const exact = chapters.filter(ch => parts.includes(normalize(ch.name)) || normalize(ch.name) === name);
	if(exact.length) return exact;
	const token = /(?:第)?(\d+(?:\.\d+)?)([话卷集回])/g;
	const key = value => [...value.matchAll(token)].map(m => m[1]+m[2]).join('|');
	const number = key(name);
	const special = /番外|特别|特別|附录|附錄|外传|外傳/;
	return number ? chapters.filter(ch => key(normalize(ch.name)) === number && special.test(ch.name) === special.test(name)) : [];
}

function request(kind, endpoint, signal)
{
	const host = kind === 'catalog' ? 'api.2024manga.com' : 'api.mangacopy.com';
	return new Promise((resolve, reject) => {
		const req = https.get('https://'+host+'/api/v3/'+endpoint, {headers: {...headers[kind], Accept: 'application/json'}, signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])}, res => {
			let body = '';
			res.setEncoding('utf8');
			res.on('error', reject);
			res.on('data', chunk => { body += chunk; if(body.length > 4e6) req.destroy(new Error('响应过大')); });
			res.on('end', () => {
				try {
					const data = JSON.parse(body);
					if(res.statusCode !== 200 || data.code !== 200) throw new Error(data.message || 'HTTP '+res.statusCode);
					resolve(data.results);
				} catch(error) { reject(error); }
			});
		});
		req.on('error', reject);
	});
}

async function catalog(slug, signal)
{
	const book = await request('catalog', 'comic2/'+encodeURIComponent(slug), signal);
	const groups = Object.values(book.groups || {});
	if(!groups.length) groups.push({name: '默认', path_word: 'default'});
	const chapters = [];
	for(const group of groups) {
		let offset = 0;
		while(true) {
			const page = await request('catalog', 'comic/'+encodeURIComponent(slug)+'/group/'+encodeURIComponent(group.path_word)+'/chapters?limit=100&offset='+offset+'&_update=true', signal);
			for(const row of page.list) chapters.push({id: row.uuid, name: row.name, group: group.name});
			offset += page.list.length;
			if(offset >= page.total) break;
			if(!page.list.length) throw new Error('目录分页不完整');
		}
	}
	return {slug, title: book.comic.name, chapters};
}

async function comments(id, offset, signal)
{
	const page = await request('comments', 'roasts?chapter_id='+encodeURIComponent(id)+'&limit=30&offset='+offset+'&_update=true', signal);
	if(!Array.isArray(page.list) || !Number.isFinite(page.total)) throw new Error('评论响应格式异常');
	return {total: page.total, list: page.list.map(row => ({id: row.id, author: row.user_name, date: row.create_at, text: row.comment}))};
}

function diskCache(dir)
{
	const filename = key => path.join(dir, createHash('sha256').update(key).digest('hex')+'.json');
	return {
		get(key) {
			try { return JSON.parse(fs.readFileSync(filename(key), 'utf8')); }
			catch { return null; }
		},
		set(key, value) {
			fs.mkdirSync(dir, {recursive: true});
			const temp = filename(key)+'.'+randomUUID()+'.tmp';
			try {
				fs.writeFileSync(temp, JSON.stringify(value));
				fs.renameSync(temp, filename(key));
			} finally { fs.rmSync(temp, {force: true}); }
		},
	};
}
module.exports = {source, archiveSource, candidates, catalog, comments, diskCache};
