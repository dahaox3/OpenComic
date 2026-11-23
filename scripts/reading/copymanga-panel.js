const path = require('node:path');
const fs = require('node:fs');
const api = require('./copymanga.js');
const history = require('./copymanga-history.js');
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
	current.pageObserver?.disconnect();
	current.dialog.remove();
	current.footer.remove();
	current = null;
}

function active(s)
{
	return current === s && s.root.isConnected && template._contentRight() === s.root;
}

function beginView(s)
{
	s.pageObserver?.disconnect();
	return ++s.view;
}

function heading(s, target, title)
{
	const head = element('header',null,target);
	element('h2',title,head);
	const close = button(head,'×',() => {
		if(target === s.dialog) {
			s.dialog.close();
		} else {
			s.root.querySelector('.reading-content').scrollIntoView({block:'end'});
		}
	});
	close.className = 'copy-close';
	close.title = '关闭并返回漫画';
	close.setAttribute('aria-label', close.title);
}

function resolveBinding(s)
{
	const {book, choices, chapter} = history.binding(s.file, storage());
	s.book = book;
	s.choices = choices;
	s.chapter = s.embedded || chapter;
	s.label = book?.chapters.find(row => row.id === s.chapter?.id)?.name || path.basename(s.file).replace(/\.(cbz|zip)$/i, '');
}

async function account(action, data = {})
{
	try { return await electron.ipcRenderer.invoke('copymanga-sync', {action, ...data}); }
	catch { return {state:'error', message:'无法连接进度同步服务，请重试。'}; }
}

function saveProgress()
{
	const s = current;
	if(!s?.chapter || !active(s) || !reading.isLoaded()) return;
	const page = Math.max(1, reading.currentPage());
	void account('sync', {...s.chapter, page, recordedAt:Date.now()});
}

function accountControls(s, target)
{
	const toggle = button(target, '拷贝账号与阅读进度', () => {
		section.hidden = !section.hidden;
		toggle.setAttribute('aria-expanded', String(!section.hidden));
		if(!section.hidden && !status.textContent) void run('status', s.chapter || {});
	});
	const section = element('section', null, target);
	section.id = target === s.dialog ? 'copy-dialog-account' : 'copy-footer-account';
	section.hidden = true;
	toggle.setAttribute('aria-controls', section.id);
	toggle.setAttribute('aria-expanded', 'false');
	const status = element('p', '', section);
	status.setAttribute('aria-live', 'polite');
	const actions = element('div', null, section);
	actions.className = 'copy-actions';
	const alive = () => active(s) && section.isConnected;
	const show = result => {
		if(!alive()) return;
		actions.replaceChildren();
		const messages = {
			'signed-out':'登录后可将本地阅读进度同步到拷贝漫画。',
			ready:'已登录，阅读时自动同步最近章节。',
			pending:'正在与网站核对最近章节…',
			synced:'网站已确认本章为最后阅读章节。',
		};
		status.textContent = result.message || messages[result.state];
		if(!result.signedIn) {
			button(actions,'登录拷贝漫画',() => run('login'));
			return;
		}
		if(s.chapter) button(actions,'同步当前章节',() => run('sync',{...s.chapter,page:Math.max(1,reading.currentPage()),recordedAt:Date.now()}));
		button(actions,'补传已读作品',importHistory);
		button(actions,'退出账号',() => run('logout'));
	};
	const run = async (action, data) => {
		actions.replaceChildren();
		status.textContent = action === 'login' ? '请在拷贝漫画官方窗口登录…' : '正在处理…';
		const result = await account(action,data);
		show(result);
	};
	const importHistory = async (conflicting = null) => {
		actions.replaceChildren();
		status.textContent = '正在查找每部作品最近阅读的章节…';
		try {
			const replace = Array.isArray(conflicting);
			const records = replace ? conflicting : await history.latestRecords(relative.get('readingProgress'), storage(), image => {
				if(!path.isAbsolute(image) || fileManager.isServer(image) || !compatible.image(image)) return null;
				return fileManager.lastCompressedFile(image) || path.dirname(image);
			});
			const conflicts = [];
			let synced = 0, kept = 0, failed = 0;
			for(const record of records) {
				if(!alive()) return;
				status.textContent = '正在补传 '+(synced+kept+failed+1)+' / '+records.length+' 部作品…';
				const result = await account('sync', {...record, historical:!replace});
				if(result.state === 'signed-out') { show(result); return; }
				if(result.state === 'synced') synced++;
				else if(result.state === 'ready') kept++;
				else failed++;
				if(result.conflict) conflicts.push(record);
			}
			show({signedIn:true,message: records.length ? '已同步 '+synced+' 部，保留已有进度 '+kept+' 部，待重试 '+failed+' 部。' : '没有找到已关联拷贝章节的本地阅读记录。'});
			if(alive() && conflicts.length) {
				const replaceButton = button(actions,'以本地章节覆盖 '+conflicts.length+' 部网站记录',() => importHistory(conflicts));
				replaceButton.title = conflicts.map(record => record.slug).join('、');
			}
		} catch { show({signedIn:true,message:'读取本地阅读记录失败，请重试。'}); }
	};
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
		if(dialog.open) return;
		s.dialogEvents?.abort();
		s.endDialog = false;
		beginView(s);
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
	saveProgress();
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

function open(atEnd = false)
{
	const s = current;
	if(!s || !active(s)) return false;
	s.endDialog = atEnd || (!!s.chapter && reading.isLoaded() && reading.currentIndex() === (reading.manga() ? 1 : reading.indexNum()));
	if(s.endDialog) {
		s.dialogEvents?.abort();
		s.dialogEvents = new AbortController();
		bindEndDialog(s);
	}
	if(!s.dialog.open) s.dialog.showModal();
	render(s, s.dialog);
	if(s.endDialog) {
		s.dialog.tabIndex = -1;
		s.dialog.focus({preventScroll:true});
	}
	return true;
}

function available()
{
	return current && active(current) && !!(current.book || current.chapter);
}

function turnInDialog(forward)
{
	const s = current;
	if(!s?.endDialog || !s.dialog.open || !active(s)) return false;
	if(forward) void continueChapter(s);
	else s.dialog.close();
	return true;
}

function end()
{
	const s = current;
	if(!available()) return false;
	if(s.scroll && !s.footer.hidden) {
		if(!turnFromGutter()) s.footer.scrollIntoView({block:'start'});
		return true;
	}
	return open(true);
}

function turnFromGutter()
{
	const s = current;
	if(!s || !active(s) || s.footer.hidden || s.dialog.open) return false;
	if(s.footer.getBoundingClientRect().top >= s.root.firstElementChild.getBoundingClientRect().bottom - 1) return false;
	void continueChapter(s);
	return true;
}

function nextChapter(s)
{
	const next = dom.nextComic();
	if(next) return {path:next, mainPath:dom.history.mainPath};
	return siblingChapter(s).then(file => file && {path:file, mainPath:s.folder}, () => null);
}

async function continueChapter(s, destination)
{
	if(!active(s) || s.turning) return;
	if(s.dialog.open) s.dialog.close();
	const index = reading.currentIndex();
	if(index < 1 || index > reading.indexNum()) return;
	s.turning = true;
	try {
		const next = destination || await nextChapter(s);
		if(!next || !active(s) || s.dialog.open || reading.currentIndex() !== index) return;
		if(!s.footer.hidden) {
			s.root.querySelector('.reading-content').scrollIntoView({block:'end'});
		}
		if(reading.manga()) reading.showPreviousComic(1, true, true, next);
		else reading.showNextComic(1, true, false, next);
	} finally { s.turning = false; }
}

function bindEndDialog(s)
{
	const options = {capture:true, passive:false, signal:AbortSignal.any([s.abort.signal,s.dialogEvents.signal])};
	const outside = point => {
		const box = s.dialog.getBoundingClientRect();
		return point.clientX < box.left || point.clientX >= box.right || point.clientY < box.top || point.clientY >= box.bottom;
	};
	const turn = (event, forward) => {
		event.preventDefault();
		event.stopImmediatePropagation();
		turnInDialog(forward);
	};
	const showing = () => s.endDialog && s.dialog.open && active(s);
	let pointer = null, touch = null;
	window.addEventListener('pointermove', event => { pointer = {clientX:event.clientX,clientY:event.clientY}; }, options);
	window.addEventListener('wheel', event => {
		if(!showing() || !outside(event) || event.ctrlKey || event.metaKey || shortcuts.sideWheelHeld(event)) return;
		const forward = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? (reading.manga() ? -event.deltaX : event.deltaX) : event.deltaY;
		if(forward) turn(event, forward > 0);
	}, options);
	window.addEventListener('click', event => {
		if(!showing() || event.button !== 0 || !event.detail || !outside(event)) return;
		const reader = s.root.getBoundingClientRect();
		const inReader = event.clientX >= reader.left && event.clientX < reader.right && event.clientY >= reader.top && event.clientY < reader.bottom;
		turn(event, inReader && !shortcuts.isPreviousTap(event));
	}, options);
	window.addEventListener('keydown', event => {
		if(!showing() || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if(pointer ? !outside(pointer) : s.dialog.querySelector(':hover')) return;
		if(event.target.closest('input,select,textarea,button,summary,a,[contenteditable=true]')) return;
		if([reading.manga() ? 'ArrowLeft' : 'ArrowRight','ArrowDown','PageDown',' '].includes(event.key)) turn(event, true);
		else if([reading.manga() ? 'ArrowRight' : 'ArrowLeft','ArrowUp','PageUp'].includes(event.key)) turn(event, false);
	}, options);
	window.addEventListener('touchstart', event => {
		const start = event.touches[0];
		touch = showing() && event.touches.length === 1 && outside(start) ? {x:start.clientX,y:start.clientY} : null;
	}, options);
	window.addEventListener('touchend', event => {
		if(!touch || !showing()) return;
		const last = event.changedTouches[0], dx = last.clientX - touch.x, dy = last.clientY - touch.y;
		touch = null;
		const distance = Math.abs(dx) > Math.abs(dy) ? (reading.manga() ? dx : -dx) : -dy;
		if(Math.abs(distance) > 35) turn(event, distance > 0);
	}, options);
}

function bindForm(s, target)
{
	const version = beginView(s);
	target.replaceChildren();
	heading(s, target, '绑定拷贝漫画作品');
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
	beginView(s);
	target.replaceChildren();
	heading(s, target, '选择对应章节');
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
	const version = beginView(s);
	target.replaceChildren();
	heading(s, target, '本章吐槽');
	element('p',s.label || path.basename(s.file),target);
	const actions = element('div',null,target);
	actions.className = 'copy-actions';
	accountControls(s,target);
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
	const scroller = target === s.dialog ? target : s.root.firstElementChild;
	const observer = s.pageObserver = new IntersectionObserver(entries => {
		for(const entry of entries) {
			if(entry.isIntersecting && entry.target.parentElement === controls) void load();
		}
	}, {root:scroller});
	const load = async (refresh = false) => {
		if(!active(s) || s.view !== version || (target === s.dialog && !s.dialog.open)) return;
		observer.disconnect();
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
		const previousCount = seen.size;
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
		if(page.list.length && offset < page.total) {
			const more = button(controls,'加载更多',() => load());
			if(seen.size > previousCount) observer.observe(more);
		}
	};
	button(actions,'刷新',() => render(s,target,true));
	void load(refresh);
	const addNext = next => button(actions,'下一话',() => {
		if(s.endDialog || target === s.footer) { void continueChapter(s,next); return; }
		reading.progress.save();
		dom.openComic(true,next.path,next.mainPath,false,false,true);
	});
	Promise.resolve(nextChapter(s)).then(next => {
		if(next && active(s) && s.view === version) addNext(next);
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
		if(/\.(cbz|zip)$/i.test(name)) {
			const source = await api.archiveSource(sibling).catch(() => null);
			if(source && source.slug === (s.chapter?.slug || s.book?.slug)) return sibling;
		}
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
module.exports = {bindFolder, attach, dispose, open, end, turnInDialog, turnFromGutter, saveProgress, get available(){return available();}, get inline(){return current?.scroll && !current.footer.hidden;}};
