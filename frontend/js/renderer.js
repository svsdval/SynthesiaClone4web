class NotesRenderer {
    constructor(canvasId, piano) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.piano = piano;
        this.midiName = '';

        this.notes = [];
        this.channelSettings = null;
        this.scrollSpeed = 200;
        this.lookaheadTime = 5.0;
        this.lookbehindTime = 2.0;
        this.playLineOffset = 1;
        this.playLineY = 0;
        
        setTimeout(() => this.resize(), 200);
    }
    
    setMidiName(name) {
        this.midiName = name;
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
    
    drawRoundRect(x, y, width, height, radius, fillColor, strokeColor) {
        if ((radius *1.5 > height) || (radius *1.5 > width))
        {
            this.ctx.fillStyle = fillColor;
            this.ctx.fillRect(x, y, width, height);
            this.ctx.strokeStyle = fillColor;
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(x, y, width, height);
        } else {
            this.ctx.beginPath();
            this.ctx.moveTo(x + radius, y);
            this.ctx.lineTo(x + width - radius, y);
            this.ctx.arcTo(x + width, y, x + width, y + radius, radius);
            this.ctx.lineTo(x + width, y + height - radius);
            this.ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            this.ctx.lineTo(x + radius, y + height);
            this.ctx.arcTo(x, y + height, x, y + height - radius, radius);
            this.ctx.lineTo(x, y + radius);
            this.ctx.arcTo(x, y, x + radius, y, radius);
            this.ctx.closePath();

            if (fillColor) {
                this.ctx.fillStyle = fillColor;
                this.ctx.fill();
            }
        
            if (strokeColor) {
                this.ctx.strokeStyle = strokeColor;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
            }
       }
    }

    updatePlayLinePosition() {
        // Линия должна быть внизу canvas, близко к клавиатуре
        this.playLineY = this.canvas.height - this.playLineOffset;
        this.adjustLookahead();
        console.log(`Play line position: ${this.playLineY}, canvas height: ${this.canvas.height}`);
    }

    drawText(x,y, text, lineWidth=2) {
              this.ctx.font = 'bold 14px Arial';
              this.ctx.fillStyle = '#FFF';
              this.ctx.strokeStyle = '#ff9900';
              this.ctx.lineWidth = lineWidth;
              this.ctx.strokeText(text, x, y);
              this.ctx.fillText(text, x, y);
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
        // Сначала рисуем белые клавиши
        visibleNotes.forEach(note => {
            if ( ! this.piano.isBlackKey(note.pitch)) {
              const timeToStart = note.start_time - currentTime;
              const timeToEnd = note.end_time - currentTime;
              
              const yStart = this.playLineY - (timeToStart * this.scrollSpeed);
              const yEnd = this.playLineY - (timeToEnd * this.scrollSpeed);
              
              if (yEnd > this.canvas.height || yStart < 0) return;
              
              const keyPos = this.piano.getKeyPosition(note.pitch);
              if (!keyPos) return;
              
              const x = keyPos.x + 2;
              const width = keyPos.width - 4;
              const noteHeight = Math.max(1, yStart - yEnd);
              
              const settings = this.channelSettings.get(note.channel);
              const color = settings ? settings.color : '#64ff64';
              
              const isPlayed = yStart > this.playLineY;
              this.drawRoundRect(x, yEnd, width, noteHeight, 6, isPlayed ? this.adjustColorBrightness(color, -50) : color, isPlayed ? '#3c3c3c' : '#000000')
              if (note.start_time <= currentTime && note.end_time >= currentTime) {
                  activeNotes.push({
                      pitch: note.pitch,
                      color: color
                  });
              }
            }
        });
        // После рисуем чёрные клавиши, что бы белые их не перекрыли...
        visibleNotes.forEach(note => {
            if ( this.piano.isBlackKey(note.pitch)) {
                const timeToStart = note.start_time - currentTime;
                const timeToEnd = note.end_time - currentTime;
                
                const yStart = this.playLineY - (timeToStart * this.scrollSpeed);
                const yEnd = this.playLineY - (timeToEnd * this.scrollSpeed);
                
                if (yEnd > this.canvas.height || yStart < 0) return;
                
                const keyPos = this.piano.getKeyPosition(note.pitch);
                if (!keyPos) return;
                
                const x = keyPos.x + 2;
                const width = keyPos.width - 4;
                const noteHeight = Math.max(1, yStart - yEnd);
                
                const settings = this.channelSettings.get(note.channel);
                const color = settings ? settings.color : '#64ff64';
                
                const isPlayed = yStart > this.playLineY;
                this.drawRoundRect(x, yEnd, width, noteHeight, 6, isPlayed ? this.adjustColorBrightness(color, -50) : color, isPlayed ? '#3c3c3c' : '#000000')

                if (note.start_time <= currentTime && note.end_time >= currentTime) {
                    activeNotes.push({
                        pitch: note.pitch,
                        color: color
                    });
                }
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
        this.drawText(0,20, this.midiName);
        
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
        if (!this.canvas) return;
        
        const container = this.canvas.parentElement;
        if (!container) return;
        
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        
        // Проверяем нужен ли вообще ресайз
        if (this.canvas.width === containerWidth && this.canvas.height === containerHeight) {
            return; // Размер не изменился, ничего не делаем
        }
        
        console.log(`NotesRenderer resize: ${this.canvas.width}x${this.canvas.height} -> ${containerWidth}x${containerHeight}`);
        
        // Сохраняем текущее время для перерисовки
        const currentRenderTime = this.lastRenderTime || 0;
        
        // Устанавливаем размер canvas
        // Важно! сначала устанавливаем width/height атрибуты, это очищает canvas
        this.canvas.width = containerWidth;
        this.canvas.height = containerHeight;
        
        // Пересоздаем контекст после ресайза
        this.ctx = this.canvas.getContext('2d', {
            alpha: false,
            desynchronized: true
        });
        
        // Обновляем линию проигрывания
        this.updatePlayLinePosition();
        
        // Перерисовываем текущее состояние
        if (this.notes && this.notes.length > 0) {
            this.render(currentRenderTime);
        }
        
        console.log('NotesRenderer resized successfully');
    }
}
