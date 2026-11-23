const zoomBindings = [['MouseUp', 'zoomIn'], ['MouseDown', 'zoomOut']];

class MouseWheel
{
	static turnsPages(bindings) {
		return (bindings.MouseUp === 'prev' && bindings.MouseDown === 'next') ||
			(bindings.MouseUp === 'next' && bindings.MouseDown === 'prev');
	}

	static useSideZoom(bindings) {
		for(const [wheel, zoom] of zoomBindings) {
			if(bindings['Ctrl+'+wheel] === zoom) {
				bindings['Side+'+wheel] ??= zoom;
				delete bindings['Ctrl+'+wheel];
			}
		}
	}

	static setPageTurns(bindings, active) {
		if(active) MouseWheel.useSideZoom(bindings);
		for(const [wheel, zoom] of zoomBindings) {
			const side = 'Side+'+wheel;
			if(active) {
				bindings[wheel] = wheel === 'MouseUp' ? 'prev' : 'next';
				bindings[side] ??= zoom;
			} else {
				bindings[wheel] = zoom;
				if(bindings[side] === zoom) {
					delete bindings[side];
					bindings['Ctrl+'+wheel] ??= zoom;
				}
			}
		}
	}

	#passive;
	#capture;
	#target;
	#heldButtons = 0;
	#usedButtons = 0;

	constructor(options = {}) {

		this.#passive = options.passive ?? false;
		this.#capture = options.capture ?? false;
		this.#target = options.target ?? false;
	}

	sideButtons(event) {
		// Some Chromium wheel events omit buttons, even between a physical press and release.
		return (event.buttons | this.#heldButtons) & 24;
	}

	updateButtons = event => {
		this.#heldButtons = event.buttons & 24;
		if(event.button !== 3 && event.button !== 4) return;
		const bit = 1 << event.button;
		if(event.type === 'mousedown') this.#usedButtons &= ~bit;
		else if(this.#usedButtons & bit) {
			event.preventDefault();
			event.stopImmediatePropagation();
			if(event.type === 'auxclick') this.#usedButtons &= ~bit;
		}
	};

	clearButtons = () => {
		this.#heldButtons = this.#usedButtons = 0;
	};

	wheel = (event) => {

		let preventDefault = false;

		const up = event.deltaY < 0;
		const down = event.deltaY > 0;
		const left = event.deltaX < 0;
		const right = event.deltaX > 0;

		const alt = event.altKey ?? false;
		const cmd = event.metaKey ?? false;
		const ctrl = event.ctrlKey ?? false;
		const shift = event.shiftKey ?? false;
		const side = this.sideButtons(event);

		let keepScrollEvent = false;

		if(!alt && !cmd && !ctrl && !shift && !side && reading.readingViewIs('scroll'))
			keepScrollEvent = true;

		for(let i = 0, length = this.shortcuts.length; i < length; i++)
		{
			const shortcut = this.shortcuts[i];

			if(shortcut.all)
			{
				shortcut.callback(event);
				preventDefault = true;
			}
			else if(shortcut.alt === alt && shortcut.cmd === cmd && shortcut.ctrl === ctrl && shortcut.shift === shift && shortcut.side === !!side)
			{
				if(shortcut.up && up && !keepScrollEvent)
					preventDefault = shortcut.callback(event);
				else if(shortcut.down && down && !keepScrollEvent)
					preventDefault = shortcut.callback(event);
				else if(shortcut.left && left)
					preventDefault = shortcut.callback(event);
				else if(shortcut.right && right)
					preventDefault = shortcut.callback(event);
			}
		}

		if(preventDefault)
		{
			this.#usedButtons |= side;
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}

	record(callback) {

		const mouseWheel = new MouseWheel({
			capture: true,
			target: document,
		});

		mouseWheel.register('all', function(event) {

			const up = event.deltaY < 0;
			const down = event.deltaY > 0;
			const left = event.deltaX < 0;
			const right = event.deltaX > 0;

			const alt = event.altKey ?? false;
			const cmd = event.metaKey ?? false;
			const ctrl = event.ctrlKey ?? false;
			const shift = event.shiftKey ?? false;

			let shortcut = '';

			if(alt) shortcut += 'alt+';
			if(cmd) shortcut += 'cmd+';
			if(ctrl) shortcut += 'ctrl+';
			if(shift) shortcut += 'shift+';

			shortcut = ShoSho.format(shortcut, 'short-inflexible-nondirectional')
			if(shortcut) shortcut += '+';
			if(mouseWheel.sideButtons(event)) shortcut += 'Side+';

			if(up)
				shortcut += 'MouseUp';
			else if(down)
				shortcut += 'MouseDown';
			else if(left)
				shortcut += 'MouseLeft';
			else if(right)
				shortcut += 'MouseRight';

			callback(shortcut);

		});

		mouseWheel.start();

		return function() {

			mouseWheel.reset();

		}

	}

	shortcuts = [];

	register(shortcut, callback) {

		this.shortcuts.push({
			up: /mouseUp/i.test(shortcut),
			down: /mouseDown/i.test(shortcut),
			left: /mouseLeft/i.test(shortcut),
			right: /mouseRight/i.test(shortcut),
			alt: /alt|option/i.test(shortcut),
			cmd: /cmd|command|meta/i.test(shortcut),
			ctrl: /ctrl|control/i.test(shortcut),
			shift: /shift/i.test(shortcut),
			side: /side/i.test(shortcut),
			all: /all/i.test(shortcut),
			callback: callback,
		});

	}

	#registred = false;

	start() {

		if(!this.#registred)
		{
			this.#target.addEventListener('wheel', this.wheel, {passive: this.#passive, capture: this.#capture});
			for(const name of ['mousedown', 'mouseup', 'auxclick'])
				window.addEventListener(name, this.updateButtons, true);
			window.addEventListener('blur', this.clearButtons);
			this.#registred = true;
		}
	}

	reset() {

		this.#target.removeEventListener('wheel', this.wheel, this.#capture);
		for(const name of ['mousedown', 'mouseup', 'auxclick'])
			window.removeEventListener(name, this.updateButtons, true);
		window.removeEventListener('blur', this.clearButtons);
		this.clearButtons();
		this.#registred = false;
		this.shortcuts = [];

	}
}

module.exports = MouseWheel;
