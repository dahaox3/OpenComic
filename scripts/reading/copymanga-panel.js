const path = require('node:path');
const fs = require('node:fs');
const api = require('./copymanga.js');
let current, cache;

function storage()
{
	return cache ||= api.diskCache(path.join(storagePath, 'copymanga'));
}

function element(tag, label, parent)
{
	const el = document.createElement(tag);
	if(label != null) el.textContent = label;
	parent?.append(el);
	return el;
}

function button(parent, label, action)
{
	const el = element('button', label, parent);
	el.type = 'button';
	el.onclick = action;
	return el;
}

function dispose()
{
	if(!current) return;
	current.abort.abort();
	current.observer?.disconnect();
	current.dialog.remove();
	current.footer.remove();
	current = null;
}

function active(s)
{
	return current === s && s.root.isConnected && template._contentRight() === s.root;
}

function resolveBinding(s)
{
	const book = storage().get('book:'+s.folder);
	s.book = book;
	const manual = book && storage().get('chapter:'+book.slug+':'+s.file);
	const choices = book ? api.candidates(path.basename(s.file), book.chapters) : [];
	s.choices = choices;
	const match = book?.chapters.find(row => row.id === manual) || (choices.length === 1 ? choices[0] : null);
	s.chapter = s.embedded || (match && {slug: book.slug, id: match.id});
	s.label = book?.chapters.find(row => row.id === s.chapter?.id)?.name || path.basename(s.file).replace(/\.(cbz|zip)$/i, '');
}

async function attach(file, root, scroll)
{
	dispose();
	if(!file) return;
	const dialog = element('dialog', null, root);
	dialog.className = 'copy-comments copy-dialog';
	const footer = element('section', null, root.firstElementChild);
	footer.className = 'copy-comments copy-footer';
	footer.hidden = true;
	const s = current = {file, folder: path.dirname(file), root, dialog, footer, scroll, abort: new AbortController(), view: 0};
	for(const target of [dialog, footer]) {
		for(const event of ['click','keydown','keyup','mousedown','mouseup','touchstart','touchend','wheel','mousewheel']) {
			target.addEventListener(event, e => e.stopPropagation());
		}
	}
	dialog.addEventListener('close', () => {
		if(!active(s)) return;
		s.view++;
		refreshFooter(s);
	});
	try {
		const stat = await fs.promises.stat(file);
		if(stat.isFile() && /\.(cbz|zip)$/i.test(file)) s.embedded = await api.archiveSource(file);
	} catch { /* A local file can move while it is being opened. */ }
	if(!active(s)) return;
	resolveBinding(s);
	refreshFooter(s);
	reading.changeHeaderButtons();
}

function refreshFooter(s)
{
	s.observer?.disconnect();
	s.footer.hidden = !s.scroll || !(s.book || s.chapter);
	if(s.footer.hidden) return;
	s.footer.replaceChildren();
	const heading = element('h2', '本章吐槽', s.footer);
	s.observer = new IntersectionObserver(entries => {
		if(!entries.some(entry => entry.isIntersecting) || !active(s) || s.dialog.open) return;
		s.observer.disconnect();
		render(s, s.footer);
	}, {root: s.root.firstElementChild});
	s.observer.observe(heading);
}

function open()
{
	const s = current;
	if(!s || !active(s)) return false;
	if(!s.dialog.open) s.dialog.showModal();
	render(s, s.dialog);
	return true;
}

function available()
{
	return current && active(current) && !!(current.book || current.chapter);
}

function end()
{
	if(!available()) return false;
	if(current.scroll && !current.footer.hidden) {
		current.footer.scrollIntoView({block:'start'});
		return true;
	}
	return open();
}

function bindForm(s, target)
{
	const version = ++s.view;
	target.replaceChildren();
	element('h2', '绑定拷贝漫画作品', target);
	element('p', '作品文件夹：'+s.folder, target);
	const form = element('form', null, target);
	const input = element('input', null, form);
	input.type = 'url';
	input.required = true;
	input.placeholder = 'https://www.mangacopy.com/comic/…';
	input.setAttribute('aria-label','作品链接');
	if(s.book) input.value = 'https://www.mangacopy.com/comic/'+s.book.slug;
	const submit = element('button', '读取目录并绑定', form);
	const status = element('p', '', form);
	form.onsubmit = async event => {
		event.preventDefault();
		const link = api.source(input.value.trim());
		if(!link) { status.textContent = '请输入有效的拷贝漫画作品链接。'; return; }
		submit.disabled = true;
		status.textContent = '正在读取章节目录…';
		try {
			const book = await api.catalog(link.slug, s.abort.signal);
			if(!active(s) || s.view !== version) return;
			storage().set('book:'+s.folder, book);
			if(s.library) { s.dialog.close(); return; }
			resolveBinding(s);
			render(s, target);
			reading.changeHeaderButtons();
		} catch(error) { status.textContent = '读取目录失败：'+error.message; }
		finally { submit.disabled = false; }
	};
	button(target, '返回', () => s.library ? s.dialog.close() : render(s, target));
}

function selectChapter(s, target)
{
	if(!s.book) return bindForm(s, target);
	s.view++;
	target.replaceChildren();
	element('h2','选择对应章节',target);
	element('p',path.basename(s.file),target);
	const select = element('select',null,target);
	select.setAttribute('aria-label','对应章节');
	const entries = [...s.choices,...s.book.chapters.filter(ch => !s.choices.includes(ch))];
	for(const ch of entries) {
		const option = element('option',ch.group+' · '+ch.name,select);
		option.value = ch.id;
		option.selected = ch.id === s.chapter?.id;
	}
	button(target,'保存章节', () => {
		if(!select.value) return;
		storage().set('chapter:'+s.book.slug+':'+s.file, select.value);
		resolveBinding(s);
		render(s,target);
	});
	button(target,'更换作品',() => bindForm(s,target));
	button(target,'返回',() => render(s,target));
}

function render(s, target, refresh = false)
{
	if(!active(s)) return;
	const version = ++s.view;
	target.replaceChildren();
	const head = element('header',null,target);
	element('h2','本章吐槽',head);
	if(target === s.dialog) button(head,'返回漫画',() => s.dialog.close());
	element('p',s.label || path.basename(s.file),target);
	const actions = element('div',null,target);
	actions.className = 'copy-actions';
	if(!s.embedded) button(actions,s.book ? '校正章节' : '绑定整本作品',() => selectChapter(s,target));
	if(!s.chapter) {
		element('p',s.book ? '请选择此文件对应的章节。' : '绑定作品后，此文件夹内的章节会按名称匹配。',target);
		return;
	}
	const list = element('ol',null,target);
	const status = element('p','',target);
	status.setAttribute('role','status');
	const controls = element('div',null,target);
	let offset = 0, firstId = '';
	const seen = new Set();
	const load = async (refresh = false) => {
		controls.replaceChildren();
		status.textContent = '正在读取吐槽…';
		const key = 'roasts:'+s.chapter.id+':'+offset+(offset ? ':'+firstId : '');
		let page = storage().get(key);
		let cached = !!page;
		try {
			if(refresh || !page) {
				page = await api.comments(s.chapter.id,offset,s.abort.signal);
				if(!active(s) || s.view !== version) return;
				storage().set(key,page);
				cached = false;
			}
		} catch(error) {
			if(!active(s) || s.view !== version) return;
			status.textContent = (page ? '刷新失败，显示已缓存内容：' : '读取失败：')+error.message;
			if(!page) { button(controls,'重试',() => load(true)); return; }
		}
		if(!active(s) || s.view !== version) return;
		if(!offset && page.list.length) firstId = page.list[0].id;
		for(const comment of page.list) {
			if(seen.has(comment.id)) continue;
			seen.add(comment.id);
			const li = element('li',null,list);
			element('strong',comment.author || '匿名',li);
			element('time',comment.date || '',li);
			element('p',comment.text,li);
		}
		offset += page.list.length;
		if(!status.textContent.startsWith('刷新失败')) status.textContent = (cached ? '已缓存 · ' : '')+(page.total ? '已显示 '+seen.size+' / '+page.total+' 条' : '本章还没有吐槽');
		if(page.list.length && offset < page.total) button(controls,'加载更多',() => load());
	};
	button(actions,'刷新',() => render(s,target,true));
	void load(refresh);
	const addNext = (next, bookRoot) => button(actions,'下一话',() => {
		reading.progress.save();
		dom.openComic(true,next,bookRoot,false,false,true);
	});
	if(dom.nextComic()) addNext(dom.nextComic(),dom.history.mainPath);
	else siblingChapter(s).then(next => {
		if(next && active(s) && s.view === version) addNext(next,s.folder);
	}).catch(() => {});
}

// Opening one CBZ directly makes it the navigation root in OpenComic.
async function siblingChapter(s)
{
	const entries = (await fs.promises.readdir(s.folder,{withFileTypes:true}))
		.filter(entry => entry.isDirectory() || /\.(cbz|zip)$/i.test(entry.name))
		.map(entry => entry.name).sort(new Intl.Collator(undefined,{numeric:true}).compare);
	const index = entries.indexOf(path.basename(s.file));
	if(index < 0) return null;
	for(const name of entries.slice(index+1)) {
		const sibling = path.join(s.folder,name);
		if(s.book && (storage().get('chapter:'+s.book.slug+':'+sibling) || api.candidates(name,s.book.chapters).length === 1)) return sibling;
		if(/\.(cbz|zip)$/i.test(name) && (await api.archiveSource(sibling))?.slug === s.chapter.slug) return sibling;
	}
	return null;
}

function bindFolder()
{
	const folder = dom.history.path;
	if(!folder || !fs.statSync(folder, {throwIfNoEntry:false})?.isDirectory()) return;
	dispose();
	const root = template._contentRight();
	const dialog = element('dialog', null, root);
	dialog.className = 'copy-comments copy-dialog';
	const s = current = {folder, root, library:true, dialog, footer:element('section'), abort:new AbortController(), view:0};
	s.book = storage().get('book:'+folder);
	dialog.addEventListener('close', () => { if(current === s) dispose(); });
	dialog.showModal();
	bindForm(s, dialog);
}
module.exports = {bindFolder, attach, dispose, open, end, get available(){return available();}, get inline(){return current?.scroll && !current.footer.hidden;}};
