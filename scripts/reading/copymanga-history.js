const path = require('node:path');
const {archiveSource, candidates} = require('./copymanga.js');

function binding(file, storage)
{
	const book = storage.get('book:'+path.dirname(file));
	const choices = book ? candidates(path.basename(file), book.chapters) : [];
	const manual = book && storage.get('chapter:'+book.slug+':'+file);
	const match = book?.chapters.find(ch => ch.id === manual) || (choices.length === 1 ? choices[0] : null);
	return {book, choices, chapter: match && {slug:book.slug,id:match.id}};
}

// Parent folders can contain a second copy of the same saved image path.
async function latestRecords(progress, storage, chapterFile)
{
	const records = Object.values(progress).filter(row => row?.path && row.lastReading > 0);
	records.sort((a,b) => b.lastReading-a.lastReading);
	const visited = new Set(), books = new Map();
	for(const row of records) {
		const file = chapterFile(row.path);
		if(!file || visited.has(file)) continue;
		visited.add(file);
		let chapter;
		if(/\.(cbz|zip)$/i.test(file)) {
			try { chapter = await archiveSource(file); } catch { continue; }
		}
		chapter ||= binding(file,storage).chapter;
		if(chapter && !books.has(chapter.slug)) {
			books.set(chapter.slug,{...chapter, page:Math.max(1,Number(row.index) || 1), recordedAt:row.lastReading, historical:true});
		}
	}
	return [...books.values()];
}

module.exports = {binding, latestRecords};
