class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
        this.samples = new Map();
        this.activeSounds = new Map();
        this.enabled = false;
        this.loading = false;
        this.volume = 0.5;
        
        // Диапазон нот для загрузки
        this.minNote = 21;  // A0
        this.maxNote = 108; // C8
        
        // Кеш доступных семплов
        this.availableSamples = [];
    }
    
    async initialize() {
        if (this.context) {
            return true;
        }
        
        try {
            // Создаем Audio Context
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            
            // Создаем master gain для управления громкостью
            this.masterGain = this.context.createGain();
            this.masterGain.gain.value = this.volume;
            this.masterGain.connect(this.context.destination);
            
            console.log('✓ Audio Engine initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize Audio Engine:', error);
            return false;
        }
    }
    
    async checkAvailableSamples() {
        try {
            const response = await fetch('http://localhost:5000/api/audio/check');
            const data = await response.json();
            
            if (data.success) {
                this.availableSamples = data.available;
                console.log(`✓ Found ${data.total} audio samples (${data.min_note}-${data.max_note})`);
                return data.available;
            }
        } catch (error) {
            console.error('Failed to check audio samples:', error);
        }
        
        return [];
    }
    
    async loadSample(note) {
        if (this.samples.has(note)) {
            return this.samples.get(note);
        }
        
        try {
            const response = await fetch(`http://localhost:5000/api/audio/piano/${note}.mp3`);
            
            if (!response.ok) {
                throw new Error(`Failed to load sample ${note}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
            
            this.samples.set(note, audioBuffer);
            return audioBuffer;
        } catch (error) {
            console.warn(`Failed to load sample for note ${note}:`, error);
            return null;
        }
    }
    
    async preloadSamples(notes = null, onProgress = null) {
        if (!this.context) {
            await this.initialize();
        }
        
        this.loading = true;
        
        // Если ноты не указаны, загружаем доступные семплы
        const notesToLoad = notes || this.availableSamples;
        
        if (notesToLoad.length === 0) {
            console.log('No samples to preload');
            this.loading = false;
            return;
        }
        
        console.log(`Preloading ${notesToLoad.length} samples...`);
        
        let loaded = 0;
        const total = notesToLoad.length;
        
        for (const note of notesToLoad) {
            await this.loadSample(note);
            loaded++;
            
            if (onProgress) {
                onProgress(loaded, total);
            }
        }
        
        this.loading = false;
        console.log(`✓ Preloaded ${loaded} samples`);
    }
    
    findNearestSample(note) {
        // Ищем ближайший доступный семпл
        if (this.samples.has(note)) {
            return note;
        }
        
        let nearest = null;
        let minDistance = Infinity;
        
        for (const availableNote of this.samples.keys()) {
            const distance = Math.abs(note - availableNote);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = availableNote;
            }
        }
        
        return nearest;
    }
    
    playNote(note, velocity = 127, duration = null) {
        if (!this.context || !this.enabled) {
            return null;
        }
        
        // Возобновляем контекст если он приостановлен
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
        
        const sample = this.samples.get(note);
        
        if (!sample) {
            // Пытаемся найти ближайший семпл и транспонировать
            const nearestNote = this.findNearestSample(note);
            if (nearestNote !== null) {
                return this.playNoteTransposed(note, nearestNote, velocity, duration);
            }
            
            console.warn(`No sample available for note ${note}`);
            return null;
        }
        
        try {
            const source = this.context.createBufferSource();
            source.buffer = sample;
            
            // Создаем gain для этой ноты
            const gainNode = this.context.createGain();
            const velocityGain = velocity / 127;
            gainNode.gain.value = velocityGain;
            
            // Подключаем: source -> gain -> master -> destination
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            const soundId = `${note}_${Date.now()}`;
            
            // Сохраняем для возможности остановки
            this.activeSounds.set(soundId, {
                source: source,
                gain: gainNode,
                note: note,
                startTime: this.context.currentTime
            });
            
            // Обработчик завершения
            source.onended = () => {
                this.activeSounds.delete(soundId);
            };
            
            // Запускаем воспроизведение
            source.start(0);
            
            // Если указана длительность, планируем остановку
            if (duration) {
                setTimeout(() => {
                    this.stopNote(note, soundId);
                }, duration * 1000);
            }
            
            return soundId;
        } catch (error) {
            console.error(`Error playing note ${note}:`, error);
            return null;
        }
    }
    
    playNoteTransposed(targetNote, sourceNote, velocity = 127, duration = null) {
        const sample = this.samples.get(sourceNote);
        if (!sample) return null;
        
        try {
            const source = this.context.createBufferSource();
            source.buffer = sample;
            
            // Транспонируем через playbackRate
            const semitones = targetNote - sourceNote;
            source.playbackRate.value = Math.pow(2, semitones / 12);
            
            const gainNode = this.context.createGain();
            const velocityGain = velocity / 127;
            gainNode.gain.value = velocityGain;
            
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            const soundId = `${targetNote}_${Date.now()}`;
            
            this.activeSounds.set(soundId, {
                source: source,
                gain: gainNode,
                note: targetNote,
                startTime: this.context.currentTime
            });
            
            source.onended = () => {
                this.activeSounds.delete(soundId);
            };
            
            source.start(0);
            
            if (duration) {
                setTimeout(() => {
                    this.stopNote(targetNote, soundId);
                }, duration * 1000);
            }
            
            return soundId;
        } catch (error) {
            console.error(`Error playing transposed note ${targetNote}:`, error);
            return null;
        }
    }
    
    stopNote(note, soundId = null) {
        if (!this.context) return;
        
        if (soundId) {
            // Останавливаем конкретный звук
            const sound = this.activeSounds.get(soundId);
            if (sound) {
                try {
                    // Fade out для плавной остановки
                    const fadeTime = 0.05; // 50ms
                    sound.gain.gain.exponentialRampToValueAtTime(
                        0.001,
                        this.context.currentTime + fadeTime
                    );
                    
                    sound.source.stop(this.context.currentTime + fadeTime);
                    this.activeSounds.delete(soundId);
                } catch (error) {
                    console.warn('Error stopping sound:', error);
                }
            }
        } else {
            // Останавливаем все звуки этой ноты
            const toStop = [];
            
            this.activeSounds.forEach((sound, id) => {
                if (sound.note === note) {
                    toStop.push(id);
                }
            });
            
            toStop.forEach(id => this.stopNote(note, id));
        }
    }
    
    stopAllNotes() {
        console.log(`Stopping ${this.activeSounds.size} active sounds...`);
        
        this.activeSounds.forEach((sound, id) => {
            try {
                const fadeTime = 0.02;
                sound.gain.gain.exponentialRampToValueAtTime(
                    0.001,
                    this.context.currentTime + fadeTime
                );
                sound.source.stop(this.context.currentTime + fadeTime);
            } catch (error) {
                // Игнорируем ошибки при остановке
            }
        });
        
        this.activeSounds.clear();
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        
        if (this.masterGain) {
            this.masterGain.gain.value = this.volume;
        }
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
        
        if (!enabled) {
            this.stopAllNotes();
        }
        
        console.log(`Audio Engine ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    getStatus() {
        return {
            initialized: this.context !== null,
            enabled: this.enabled,
            loading: this.loading,
            samplesLoaded: this.samples.size,
            activeSounds: this.activeSounds.size,
            volume: this.volume,
            state: this.context?.state
        };
    }
}