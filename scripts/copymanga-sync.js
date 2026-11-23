const {pathToFileURL} = require('node:url');
const {setTimeout: delay} = require('node:timers/promises');
const path = require('node:path');

const website = 'https://www.mangacopy.com';
const loginPage = website+'/web/login/?url=person/home';
const ready = () => ({signedIn:true, state:'ready'});
const signedOut = () => ({signedIn:false, state:'signed-out'});
const identifier = /^[\w-]{1,128}$/;

async function readBrowse(partition, token, slug, signal)
{
	const url = 'https://api.mangacopy.com/api/v3/comic2/'+encodeURIComponent(slug)+'/query?platform=3&_update=true';
	const response = await partition.fetch(url, {
		credentials:'omit', redirect:'error', cache:'no-store', signal,
		headers:{Authorization:'Token '+token, Accept:'application/json', 'User-Agent':'COPY/3.0.0',
			region:'1', webp:'1', source:'copyApp', version:'3.1.1', Referer:'com.copymanga.app-3.0.0'},
	});
	if(response.status === 401) return {signedIn:false};
	if(!response.ok) throw new Error('无法查询网站阅读记录（HTTP '+response.status+'）');
	const data = await response.json();
	if(data.code === 401 || data.results?.is_login === false) return {signedIn:false};
	if(data.code !== 200 || ![true,1].includes(data.results?.is_login) || !Object.hasOwn(data.results,'browse'))
		throw new Error('网站未提供可验证的已登录阅读记录');
	return {signedIn:true, id:data.results.browse?.chapter_id || null};
}

async function confirmChapter(desired, read, visit, wait)
{
	const remote = await read();
	if(!remote.signedIn) return signedOut();
	const confirmed = {signedIn:true,state:'synced'};
	if(remote.id === desired.id) return confirmed;
	// The website's browse entry does not provide a reliable timestamp for comparing devices.
	if(desired.historical && remote.id) return {...ready(),conflict:true,message:'已保留网站现有进度'};
	const finish = await visit();
	try {
		for(const interval of [0,400,1000]) {
			if(interval) await wait(interval);
			const current = await read();
			if(!current.signedIn) return signedOut();
			if(current.id === desired.id) return confirmed;
		}
		throw new Error('网站尚未确认此章节的进度，可稍后重试');
	} finally {
		finish?.();
	}
}

function isolateWindow(win)
{
	win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
	const restrict = (event, url) => {
		if(!URL.canParse(url) || new URL(url).origin !== website) event.preventDefault();
	};
	win.webContents.on('will-navigate',restrict);
	win.webContents.on('will-redirect',restrict);
}

// One newest pending chapter per book. All writes for that book finish in order.
function createQueue(update)
{
	const books = new Map();
	const lifetime = new AbortController();
	let closed = false;

	function status(slug, id)
	{
		const entry = books.get(slug);
		return entry && (!id || entry.wanted.id === id) ? entry.result : ready();
	}

	async function drain(entry)
	{
		do {
			const desired = entry.wanted;
			let result;
			try {
				result = await update(desired, lifetime.signal);
			} catch(error) {
				result = {signedIn:true,state:'error',message:error.message};
			}
			if(closed) return;
			if(entry.wanted === desired) {
				entry.result = result;
				entry.checked = Date.now();
				return;
			}
		} while(!closed);
	}

	function sync(request)
	{
		if(closed) return Promise.resolve(signedOut());
		if(typeof request.slug !== 'string' || !identifier.test(request.slug) ||
			typeof request.id !== 'string' || !identifier.test(request.id)) {
			return Promise.resolve({signedIn:true,state:'error',message:'章节标识无效'});
		}
		const historical = request.historical === true;
		const recordedAt = Math.min(request.recordedAt ?? Date.now(), Date.now());
		if(!Number.isFinite(recordedAt) || recordedAt <= 0 || (historical && !Number.isFinite(request.recordedAt))) {
			return Promise.resolve({signedIn:true,state:'error',message:'阅读时间无效'});
		}
		const desired = {slug:request.slug, id:request.id, recordedAt, historical};
		let entry = books.get(request.slug);
		if(!entry) {
			entry = {};
			books.set(request.slug, entry);
		}
		if(entry.wanted && desired.recordedAt < entry.wanted.recordedAt && desired.id !== entry.wanted.id) {
			return Promise.resolve({...ready(),message:'已保留较新的阅读进度'});
		}

		if(entry.wanted?.id === desired.id && entry.wanted.recordedAt > recordedAt) {
			desired.recordedAt = entry.wanted.recordedAt;
			desired.historical = entry.wanted.historical;
		}
		const same = entry.wanted?.id === desired.id && entry.wanted?.historical === desired.historical;
		if(same) {
			entry.wanted.recordedAt = Math.max(recordedAt,entry.wanted.recordedAt);
			if(entry.running) return entry.running.then(() => closed ? signedOut() : status(request.slug,request.id));
			if(entry.result.state === 'synced' && Date.now()-entry.checked < 120000) return Promise.resolve(entry.result);
		}
		entry.wanted = desired;
		entry.result = {signedIn:true,state:'pending'};
		if(!entry.running) {
			entry.running = drain(entry).finally(() => {entry.running = null;});
		}
		return entry.running.then(() => closed ? signedOut() : status(request.slug, request.id));
	}

	return {sync, status, close() {closed = true; lifetime.abort(); books.clear();}};
}

function install(windows)
{
	const {BrowserWindow, ipcMain, session} = require('electron');
	const partition = session.fromPartition('persist:copymanga-account');
	const localPage = pathToFileURL(path.join(__dirname,'../templates/index.html')).href;
	let loginWindow = null, loginResult = null, token = '', queue = null, resetting = false;
	let generation = 0;
	const visits = new Set();
	const preferences = {session:partition, sandbox:true, nodeIntegration:false, contextIsolation:true};

	async function visitChapter(desired, signal)
	{
		signal.throwIfAborted();
		const win = new BrowserWindow({show:false, skipTaskbar:true, webPreferences:{...preferences,backgroundThrottling:false}});
		const id = win.webContents.id;
		visits.add(id);
		isolateWindow(win);
		const close = () => {
			signal.removeEventListener('abort',close);
			visits.delete(id);
			if(!win.isDestroyed()) win.destroy();
		};
		signal.addEventListener('abort',close,{once:true});
		try {
			await win.loadURL(website+'/comic/'+encodeURIComponent(desired.slug)+'/chapter/'+encodeURIComponent(desired.id),
				{extraHeaders:'Cache-Control: no-cache\r\nPragma: no-cache\r\n'});
			signal.throwIfAborted();
			return close;
		} catch {
			close();
			throw new Error('官网章节页面加载失败，请重试');
		}
	}

	function clear()
	{
		++generation;
		queue?.close();
		queue = null;
		token = '';
	}
	async function account()
	{
		const current = generation;
		const cookies = await partition.cookies.get({url:website+'/',name:'token'});
		const value = cookies[0]?.value || '';
		if(resetting) return null;
		if(current !== generation) return value === token ? queue : null;
		if(value !== token) {
			clear();
			token = value;
			if(value) queue = createQueue(async (desired,signal) => {
				const deadline = AbortSignal.any([signal,AbortSignal.timeout(30000)]);
				const result = await confirmChapter(desired,
					() => readBrowse(partition,value,desired.slug,deadline),
					() => visitChapter(desired,deadline),
					ms => delay(ms,null,{signal:deadline}));
				if(!result.signedIn && token === value) {
					const cookies = await partition.cookies.get({url:website+'/',name:'token'});
					if(cookies[0]?.value === value) await partition.cookies.remove(website+'/', 'token');
				}
				return result;
			});
		}
		return queue;
	}

	function login(parent)
	{
		if(loginResult) {
			loginWindow?.focus();
			return loginResult;
		}
		const win = new BrowserWindow({
			parent, width:920, height:720, title:'登录拷贝漫画', autoHideMenuBar:true,
			webPreferences:preferences,
		});
		loginWindow = win;
		win.removeMenu();
		isolateWindow(win);
		const changed = (_event,cookie,_cause,removed) => {
			if(!removed && cookie.name === 'token' && cookie.value && !win.isDestroyed()) {
				account().then(sessionQueue => {if(sessionQueue && !win.isDestroyed()) win.close();}).catch(() => {});
			}
		};
		partition.cookies.on('changed', changed);
		loginResult = new Promise(resolve => {
			win.once('closed',async () => {
				partition.cookies.off('changed', changed);
				loginWindow = null;
				loginResult = null;
				try { resolve(await account() ? ready() : signedOut()); }
				catch { resolve(signedOut()); }
			});
		});
		win.loadURL(loginPage).catch(() => {});
		return loginResult;
	}

	partition.setPermissionRequestHandler((_contents,_permission,done) => done(false));
	partition.webRequest.onBeforeRequest((details,done) => {
		done({cancel:visits.has(details.webContentsId) && ['image','media'].includes(details.resourceType)});
	});
	partition.cookies.on('changed', (_event,cookie,_cause,removed) => {
		if(token && cookie.name === 'token' && ['www.mangacopy.com','mangacopy.com'].includes(cookie.domain.replace(/^\./,'')) &&
			(removed || cookie.value !== token)) clear();
	});
	ipcMain.handle('copymanga-sync', async (event, request) => {
		const frame = event.senderFrame;
		const parent = BrowserWindow.fromWebContents(event.sender);
		if(!parent || !Array.from(windows.values()).includes(parent) || !frame || frame !== event.sender.mainFrame ||
			frame.url.split(/[?#]/,1)[0] !== localPage) throw new Error('无效的阅读器窗口');
		try {
			const action = request?.action;
			if(action === 'logout') {
				resetting = true;
				clear();
				loginWindow?.close();
				try { await partition.clearStorageData(); }
				finally { resetting = false; }
				return signedOut();
			}
			if(resetting) return signedOut();
			const sessionQueue = await account();
			if(action === 'login') return sessionQueue ? ready() : login(parent);
			if(!sessionQueue) return signedOut();
			if(action === 'status') return sessionQueue.status(request.slug,request.id);
			if(action === 'sync') return sessionQueue.sync(request);
			return {signedIn:true,state:'error',message:'不支持的同步操作'};
		} catch { return {signedIn:!!token,state:'error',message:'无法访问拷贝漫画登录会话，请重试'}; }
	});
}

module.exports = {install, createQueue, confirmChapter};
