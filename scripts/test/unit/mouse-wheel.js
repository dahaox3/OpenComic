const {test} = require('node:test');
const assert = require('node:assert/strict');
const MouseWheel = require('../../shortcuts/mouse-wheel.js');

test('existing page-turn shortcuts use side zoom and retain custom actions', () => {
	const bindings = {MouseUp:'next', MouseDown:'prev', 'Ctrl+MouseUp':'zoomIn', 'Ctrl+MouseDown':'bookmark'};
	assert.ok(MouseWheel.turnsPages(bindings));
	MouseWheel.useSideZoom(bindings);
	assert.deepEqual(bindings, {MouseUp:'next', MouseDown:'prev', 'Side+MouseUp':'zoomIn', 'Ctrl+MouseDown':'bookmark'});
	MouseWheel.setPageTurns(bindings, true);
	assert.equal(bindings['Side+MouseDown'], 'zoomOut');
	assert.equal(bindings['Ctrl+MouseDown'], 'bookmark');
	MouseWheel.setPageTurns(bindings, false);
	assert.deepEqual(bindings, {MouseUp:'zoomIn', MouseDown:'zoomOut', 'Ctrl+MouseUp':'zoomIn', 'Ctrl+MouseDown':'bookmark'});
});

test('a wheel chord consumes the side click and releases back to page turns', () => {
	global.reading = {readingViewIs: () => false};
	const mouse = new MouseWheel();
	const calls = [];
	for(const [key, action] of Object.entries({MouseUp:'prev', MouseDown:'next', 'Side+MouseUp':'zoomIn', 'Side+MouseDown':'zoomOut'}))
		mouse.register(key, () => { calls.push(action); return true; });
	const input = props => Object.assign(new Event(props.type || 'wheel', {cancelable:true}), props);
	const button = (type, index, buttons) => {
		const event = Object.assign(new Event(type, {cancelable:true}), {button:index, buttons});
		mouse.updateButtons(event);
		return event.defaultPrevented;
	};
	mouse.wheel(input({deltaY:-10, ctrlKey:true}));
	for(const [index, mask] of [[3,8],[4,16]]) {
		button('mousedown', index, mask);
		mouse.wheel(input({deltaY:-10, buttons:mask}));
		mouse.wheel(input({deltaY:10, buttons:0}));
		assert.ok(button('mouseup', index, 0));
		assert.ok(button('auxclick', index, 0));
		mouse.wheel(input({deltaY:10, buttons:0}));
		button('mousedown', index, mask);
		assert.equal(button('mouseup', index, 0), false);
	}
	assert.deepEqual(calls, ['zoomIn','zoomOut','next','zoomIn','zoomOut','next']);
});
