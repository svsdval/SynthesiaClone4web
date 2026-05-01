class PianoKeyboard {
    constructor(svgId) {
        this.svg = document.getElementById(svgId);
        this.keys = new Map();
        this.activeKeys = new Set();
        this.minNote = 21;
        this.maxNote = 108;
        this.height = 150;
        
        this.whiteKeyWidth = 0;
        this.whiteKeyCount = 0;
        this.isInitialized = false;

        this.channelSettings = null;
        
        setTimeout(() => this.initializeKeys(), 100);
    }
    
    isBlackKey(note) {
        const noteInOctave = note % 12;
        return [1, 3, 6, 8, 10].includes(noteInOctave);
    }
    
    safeMin(maxValue, variable) {
        // Проверяем, является ли переменная числом
        if (typeof variable !== 'number' || isNaN(variable)) {
            return maxValue;
        }
        
        // Проверяем, является ли число конечным
        if (!isFinite(variable)) {
            return maxValue;
        }
        
        return Math.min(maxValue, variable);
    }

    safeMax(minValue, variable) {
        // Проверяем, является ли переменная числом
        if (typeof variable !== 'number' || isNaN(variable)) {
            return minValue;
        }
        
        // Проверяем, является ли число конечным
        if (!isFinite(variable)) {
            return minValue;
        }
        
        return Math.max(minValue, variable);
    }

    calculateLayout(notes, channelSettings) {
        if (!notes || notes.length === 0) {
          console.log('no notes to calculate Layout');
          return;
        }
        this.channelSettings = channelSettings;
        var visibleNotes = null;
        if (!channelSettings) { 
           visibleNotes = notes;
        } else {
           visibleNotes = notes.filter(note => {
            const settings = channelSettings.get(note.channel);
            if (!settings || !settings.visible) return false;
            
            return true;
        });

        }

        const notePitches = visibleNotes.map(n => n.pitch);
        this.minNote = this.safeMax(21, Math.min(...notePitches) - 3);
        this.maxNote = this.safeMin(108, Math.max(...notePitches) + 3);
        
        console.log(`Calculating piano layout for notes ${this.minNote}-${this.maxNote}`);
        this.initializeKeys();
    }
    
    initializeKeys() {
        if (!this.svg) {
            console.error('SVG element not found');
            return;
        }
        
        this.svg.innerHTML = '';
        this.keys.clear();
        
        let whiteKeyCount = 0;
        for (let note = this.minNote; note <= this.maxNote; note++) {
            if (!this.isBlackKey(note)) {
                whiteKeyCount++;
            }
        }
        
        if (whiteKeyCount === 0) {
            console.error('No white keys to render');
            return;
        }
        
        this.whiteKeyCount = whiteKeyCount;
        
        const container = this.svg.parentElement;
        if (!container) {
            console.error('SVG container not found');
            return;
        }
        
        const containerWidth = container.clientWidth || 1280;
        this.height = 150;
        
        const whiteKeyWidth = containerWidth / whiteKeyCount;
        this.whiteKeyWidth = whiteKeyWidth;
        
        const blackKeyWidth = whiteKeyWidth * 0.6;
        const blackKeyHeight = this.height * 0.66;
        
        console.log(`Piano dimensions: ${containerWidth}x${this.height}, ${whiteKeyCount} white keys, key width: ${whiteKeyWidth.toFixed(2)}`);
        
        const whiteKeys = [];
        const blackKeys = [];
        
        let whiteKeyIndex = 0;
        
        for (let note = this.minNote; note <= this.maxNote; note++) {
            if (!this.isBlackKey(note)) {
                const key = {
                    note: note,
                    x: whiteKeyIndex * whiteKeyWidth,
                    width: whiteKeyWidth,
                    height: this.height,
                    isBlack: false,
                    element: null
                };
                whiteKeys.push(key);
                this.keys.set(note, key);
                whiteKeyIndex++;
            }
        }
        
        whiteKeyIndex = 0;
        for (let note = this.minNote; note <= this.maxNote; note++) {
            if (!this.isBlackKey(note)) {
                whiteKeyIndex++;
            } else {
                const key = {
                    note: note,
                    x: whiteKeyIndex * whiteKeyWidth - blackKeyWidth / 2,
                    width: blackKeyWidth,
                    height: blackKeyHeight,
                    isBlack: true,
                    element: null
                };
                blackKeys.push(key);
                this.keys.set(note, key);
            }
        }
        
        whiteKeys.forEach(key => {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', key.x);
            rect.setAttribute('y', 0);
            rect.setAttribute('width', key.width);
            rect.setAttribute('height', key.height);
            rect.setAttribute('class', 'white-key');
            rect.setAttribute('data-note', key.note);
            this.svg.appendChild(rect);
            key.element = rect;
        });
        
        blackKeys.forEach(key => {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', key.x);
            rect.setAttribute('y', 0);
            rect.setAttribute('width', key.width);
            rect.setAttribute('height', key.height);
            rect.setAttribute('class', 'black-key');
            rect.setAttribute('data-note', key.note);
            this.svg.appendChild(rect);
            key.element = rect;
        });
        
        this.svg.setAttribute('width', containerWidth);
        this.svg.setAttribute('height', this.height);
        this.svg.setAttribute('viewBox', `0 0 ${containerWidth} ${this.height}`);
        this.svg.setAttribute('preserveAspectRatio', 'none');
        
        this.isInitialized = true;
        
        console.log(`✓ Piano keyboard rendered: ${whiteKeys.length} white keys, ${blackKeys.length} black keys`);
    }
    
    setKeyActive(note, active, color = null) {
        const key = this.keys.get(note);
        if (!key || !key.element) {
            return;
        }
        
        if (active) {
            this.activeKeys.add(note);
            if (color) {
                key.element.style.fill = color;
            } else {
                key.element.classList.add('active');
            }
        } else {
            this.activeKeys.delete(note);
            key.element.classList.remove('active');
            key.element.style.fill = '';
        }
    }
    
    updateActiveNotes(notes) {
        this.activeKeys.forEach(note => {
            const key = this.keys.get(note);
            if (key && key.element) {
                key.element.classList.remove('active');
                key.element.style.fill = '';
            }
        });
        this.activeKeys.clear();
        
        notes.forEach(note => {
            this.setKeyActive(note.pitch, true, note.color);
        });
    }
    
    clearActive() {
        this.activeKeys.forEach(note => {
            this.setKeyActive(note, false);
        });
        this.activeKeys.clear();
    }
    
    getKeyPosition(note) {
        return this.keys.get(note);
    }
    
    resize() {
        const container = this.svg.parentElement;
        if (container) {
            console.log(`Resizing piano keyboard from ${this.minNote} to ${this.maxNote}`);
            this.initializeKeys();
        }
    }
}