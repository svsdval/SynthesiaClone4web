class NotesRenderer {
    constructor(canvasId, piano) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.piano = piano;
        
        this.notes = [];
        this.channelSettings = null;
        this.scrollSpeed = 200;
        this.lookaheadTime = 5.0;
        this.lookbehindTime = 2.0;
        this.playLineOffset = 10;
        this.playLineY = 0;
        
        setTimeout(() => this.resize(), 200);
    }
    
    setNotes(notes, channelSettings) {
        this.notes = notes;
        this.channelSettings = channelSettings;
    }
    
    setScrollSpeed(speed) {
        this.scrollSpeed = speed;
        this.adjustLookahead();
    }
    
    adjustLookahead() {
        const progressBarHeight = 60;
        const visibleHeight = this.playLineY - progressBarHeight;
        this.lookaheadTime = visibleHeight / this.scrollSpeed + 1.0;
    }
    
    updatePlayLinePosition() {
        // Линия должна быть внизу canvas, близко к клавиатуре
        this.playLineY = this.canvas.height - this.playLineOffset;
        this.adjustLookahead();
        console.log(`Play line position: ${this.playLineY}, canvas height: ${this.canvas.height}`);
    }
    
    render(currentTime) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (this.piano.whiteKeyCount === 0) {
            return [];
        }
        
        const activeNotes = [];
        
        const visibleNotes = this.notes.filter(note => {
            if (!this.channelSettings) return false;
            const settings = this.channelSettings.get(note.channel);
            if (!settings || !settings.visible) return false;
            
            return note.end_time >= currentTime - this.lookbehindTime &&
                   note.start_time <= currentTime + this.lookaheadTime;
        });
        
        visibleNotes.forEach(note => {
            const timeToStart = note.start_time - currentTime;
            const timeToEnd = note.end_time - currentTime;
            
            const yStart = this.playLineY - (timeToStart * this.scrollSpeed);
            const yEnd = this.playLineY - (timeToEnd * this.scrollSpeed);
            
            if (yEnd > this.canvas.height || yStart < 50) return;
            
            const keyPos = this.piano.getKeyPosition(note.pitch);
            if (!keyPos) return;
            
            const x = keyPos.x + 2;
            const width = keyPos.width - 4;
            const noteHeight = Math.max(1, yStart - yEnd);
            
            const settings = this.channelSettings.get(note.channel);
            const color = settings ? settings.color : '#64ff64';
            
            const isPlayed = yStart > this.playLineY;
            
            this.ctx.fillStyle = isPlayed ? this.adjustColorBrightness(color, -50) : color;
            this.ctx.fillRect(x, yEnd, width, noteHeight);
            
            this.ctx.strokeStyle = isPlayed ? '#3c3c3c' : '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, yEnd, width, noteHeight);
            
            if (note.start_time <= currentTime && note.end_time >= currentTime) {
                activeNotes.push({
                    pitch: note.pitch,
                    color: color
                });
            }
        });
        
        // Линия воспроизведения - красная, яркая, внизу canvas
        this.ctx.strokeStyle = '#ff0000';
        this.ctx.lineWidth = 4;
        this.ctx.shadowColor = '#ff0000';
        this.ctx.shadowBlur = 10;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.playLineY);
        this.ctx.lineTo(this.canvas.width, this.playLineY);
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
        
        return activeNotes;
    }
    
    adjustColorBrightness(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    
    resize() {
        const container = this.canvas.parentElement;
        if (!container) return;
        
        // Canvas должен занимать все доступное пространство своего контейнера
        const rect = container.getBoundingClientRect();
        this.canvas.width = rect.width || 1280;
        this.canvas.height = rect.height || 600;
        
        this.updatePlayLinePosition();
        
        console.log(`Canvas resized: ${this.canvas.width}x${this.canvas.height}, play line at: ${this.playLineY}`);
    }
}
