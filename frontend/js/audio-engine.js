class AudioEngine {
    constructor() {
        this.context = null;
        this.masterGain = null;
        
        // Изменяем структуру: теперь samples это Map<channel, Map<note, buffer>>
        this.channelSamples = new Map();
        this.channelFolders = new Map(); // Какая папка для какого канала
        
        this.activeSounds = new Map();
        this.enabled = false;
        this.loading = false;
        this.volume = 0.5;
        
        this.minNote = 0;
        this.maxNote = 127;
        this.usePianoOnly = false;
        
        this.totalBytesLoaded = 0; // Отслеживание размера загруженных сэмплов
        this.sampleSizes = new Map(); // Хранит размер каждого сэмпла
        
        // Параметры для fade-out
        this.fadeOutTime = 0.15; // 50ms - плавное затухание
    }
    
    async initialize() {
        if (this.context) {
            return true;
        }
        
        try {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
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
    
    async checkAvailableSamples(channelSettings) {
        if (!channelSettings) {
            console.warn('No channel settings provided');
            return {};
        }
        // Если режим "piano only", загружаем только piano для всех каналов
        if (this.usePianoOnly) {
            console.log('Audio Engine in Piano Only mode - using piano samples for all channels');
            
            const result = {};
            const pianoFolder = 'piano';
            const folderPath = `./audio/${pianoFolder}`;
            
            channelSettings.forEach((settings, channel) => {
                this.channelFolders.set(channel, pianoFolder);
                result[channel] = {
                    folder: pianoFolder,
                    available: [],
                    total: 0
                };
            });
            
            // Проверяем доступные ноты в папке piano
            try {
                const response = await fetch('http://localhost:5000/api/audio/check', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        channels: {
                            '0': { program: 0, bank: 0 } // Просто проверяем piano
                        }
                    })
                });
                
                const data = await response.json();
                if (data.success && data.channels['0']) {
                    const pianoSamples = data.channels['0'].available;
                    
                    // Применяем те же сэмплы для всех каналов
                    channelSettings.forEach((settings, channel) => {
                        result[channel].available = pianoSamples;
                        result[channel].total = pianoSamples.length;
                    });
                }
            } catch (error) {
                console.error('Failed to check piano samples:', error);
            }
            
            return result;
        }
        // Логика для разных инструментов
        try {
            // Формируем информацию о каналах
            const channelsInfo = {};
            channelSettings.forEach((settings, channel) => {
                channelsInfo[channel] = {
                    program: settings.program || 0,
                    bank: settings.bank || 0
                };
            });
            
            const response = await fetch('http://localhost:5000/api/audio/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channels: channelsInfo })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Сохраняем информацию о папках для каждого канала
                Object.keys(data.channels).forEach(channelStr => {
                    const channel = parseInt(channelStr);
                    const channelData = data.channels[channelStr];
                    this.channelFolders.set(channel, channelData.folder);
                    console.log(`Channel ${channel}: ${channelData.total} samples in folder "${channelData.folder}"`);
                });
                
                return data.channels;
            }
        } catch (error) {
            console.error('Failed to check audio samples:', error);
        }
        
        return {};
    }
    
    setPianoOnly(enabled) {
        const wasChanged = this.usePianoOnly !== enabled;
        this.usePianoOnly = enabled;
        
        console.log(`Audio Engine Piano Only mode: ${enabled ? 'ON' : 'OFF'}`);
        
        if (wasChanged) {
            // Очищаем все загруженные сэмплы при переключении
            this.channelSamples.clear();
            this.channelFolders.clear();

            // Сбрасываем счетчики размера
            this.sampleSizes.clear();
            this.totalBytesLoaded = 0;
            console.log('Cleared all loaded samples due to mode change');
        }
        
        return wasChanged;
    }
    
    async loadSample(channel, note) {
        // Проверяем, есть ли уже сэмпл для этого канала и ноты
        if (!this.channelSamples.has(channel)) {
            this.channelSamples.set(channel, new Map());
        }
        
        const channelMap = this.channelSamples.get(channel);
        if (channelMap.has(note)) {
            return channelMap.get(note);
        }
        
        // Определяем папку для этого канала
        const folder = this.channelFolders.get(channel) || 'piano';
        
        try {
            const response = await fetch(`http://localhost:5000/api/audio/${folder}/${note}.mp3`);
            
            if (!response.ok) {
                console.warn(`Sample not found: ${folder}/${note}.mp3`);
                return null;
            }
            
            const arrayBuffer = await response.arrayBuffer();
            // Отслеживаем размер
            const sampleSize = arrayBuffer.byteLength;
            const sampleKey = `${channel}_${note}`;
            this.sampleSizes.set(sampleKey, sampleSize);
            this.totalBytesLoaded += sampleSize;

            const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
            
            channelMap.set(note, audioBuffer);
            return audioBuffer;
        } catch (error) {
            console.warn(`Failed to load sample ${folder}/${note}.mp3:`, error);
            return null;
        }
    }
    
    async preloadSamplesForChannel(channel, notes, onProgress = null) {
        if (!this.context) {
            await this.initialize();
        }
        
        this.loading = true;
        
        const folder = this.channelFolders.get(channel) || 'piano';
        console.log(`Preloading ${notes.length} samples for channel ${channel} (${folder})...`);
        
        let loaded = 0;
        const total = notes.length;
        
        for (const note of notes) {
            await this.loadSample(channel, note);
            loaded++;
            
            if (onProgress) {
                onProgress(loaded, total, channel);
            }
        }
        
        this.loading = false;
        console.log(`✓ Preloaded ${loaded} samples for channel ${channel}`);
    }
    
    findNearestSample(channel, note) {
        const channelMap = this.channelSamples.get(channel);
        if (!channelMap) return null;
        
        // Если есть точный сэмпл
        if (channelMap.has(note)) {
            return note;
        }
        
        // Ищем ближайший
        let nearest = null;
        let minDistance = Infinity;
        
        for (const availableNote of channelMap.keys()) {
            const distance = Math.abs(note - availableNote);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = availableNote;
            }
        }
        
        return nearest;
    }
    
    playNote(note, velocity = 127, channel = 0, duration = null) {
        if (!this.context || !this.enabled) {
            return null;
        }
        
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
        
        const channelMap = this.channelSamples.get(channel);
        let sample = channelMap ? channelMap.get(note) : null;
        let actualNote = note;
        
        if (!sample) {
            // Пробуем найти ближайший сэмпл
            const nearestNote = this.findNearestSample(channel, note);
            if (nearestNote !== null) {
                sample = channelMap.get(nearestNote);
                actualNote = nearestNote;
            }
        }
        
        if (!sample) {
            console.warn(`No sample available for note ${note} on channel ${channel}`);
            return null;
        }
        
        try {
            const source = this.context.createBufferSource();
            source.buffer = sample;
            
            // Транспонирование если используем не точный сэмпл
            if (actualNote !== note) {
                const semitones = note - actualNote;
                source.playbackRate.value = Math.pow(2, semitones / 12);
            }
            
            const gainNode = this.context.createGain();
            const velocityGain = velocity / 127;
            gainNode.gain.value = velocityGain;
            
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            const soundId = `${channel}_${note}_${Date.now()}`;
            
            this.activeSounds.set(soundId, {
                source: source,
                gain: gainNode,
                note: note,
                channel: channel,
                startTime: this.context.currentTime,
                stopping: false // Флаг для предотвращения двойной остановки
            });
            
            source.onended = () => {
                this.activeSounds.delete(soundId);
            };
            
            source.start(0);
            
            if (duration) {
                setTimeout(() => {
                    this.stopNote(note, channel, soundId);
                }, duration * 1000);
            }
            
            return soundId;
        } catch (error) {
            console.error(`Error playing note ${note} on channel ${channel}:`, error);
            return null;
        }
    }
    
    stopNote(note, channel = null, soundId = null) {
        if (!this.context) return;
        
        if (soundId) {
            const sound = this.activeSounds.get(soundId);
            if (sound && !sound.stopping) {
                try {
                    sound.stopping = true;
                    
                    const now = this.context.currentTime;
                    const fadeTime = this.fadeOutTime;
                    
                    // Отменяем все предыдущие автоматизации
                    sound.gain.gain.cancelScheduledValues(now);
                    
                    // Устанавливаем текущее значение
                    sound.gain.gain.setValueAtTime(sound.gain.gain.value, now);
                    
                    // Плавное затухание до очень малого значения (не до 0, чтобы избежать ошибок)
                    sound.gain.gain.linearRampToValueAtTime(0.0001, now + fadeTime);
                    
                    // Останавливаем источник после затухания
                    sound.source.stop(now + fadeTime + 0.01);
                    
                    // Удаляем из активных звуков с небольшой задержкой
                    setTimeout(() => {
                        this.activeSounds.delete(soundId);
                    }, (fadeTime + 0.02) * 1000);
                    
                } catch (error) {
                    // Если произошла ошибка, просто удаляем звук
                    console.warn('Error stopping sound:', error);
                    this.activeSounds.delete(soundId);
                }
            }
        } else {
            const toStop = [];
            
            this.activeSounds.forEach((sound, id) => {
                if (sound.note === note && (channel === null || sound.channel === channel)) {
                    toStop.push(id);
                }
            });
            
            toStop.forEach(id => this.stopNote(note, channel, id));
        }
    }
    
    stopAllNotes() {
        console.log(`Stopping ${this.activeSounds.size} active sounds...`);
        
        const now = this.context ? this.context.currentTime : 0;
        const fadeTime = this.fadeOutTime;
        
        this.activeSounds.forEach((sound, id) => {
            if (!sound.stopping) {
                try {
                    sound.stopping = true;
                    
                    // Отменяем все предыдущие автоматизации
                    sound.gain.gain.cancelScheduledValues(now);
                    
                    // Устанавливаем текущее значение
                    sound.gain.gain.setValueAtTime(sound.gain.gain.value, now);
                    
                    // Плавное затухание
                    sound.gain.gain.linearRampToValueAtTime(0.0001, now + fadeTime);
                    
                    // Останавливаем источник
                    sound.source.stop(now + fadeTime + 0.01);
                    
                } catch (error) {
                    // Ignore errors when stopping
                }
            }
        });
        
        // Очищаем все звуки после завершения fade-out
        setTimeout(() => {
            this.activeSounds.clear();
        }, (fadeTime + 0.02) * 1000);
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

    // Метод для получения размера в читаемом формате
    getLoadedSizeFormatted() {
        const bytes = this.totalBytesLoaded;
        
        if (bytes === 0) return '0 MB';
        
        const mb = bytes / (1024 * 1024);
        
        if (mb < 0.1) {
            const kb = bytes / 1024;
            return `${kb.toFixed(1)} KB`;
        }
        
        return `${mb.toFixed(2)} MB`;
    }
    
    // Метод для получения детальной информации о размере
    getSizeInfo() {
        const channelSizes = new Map();
        
        this.sampleSizes.forEach((size, key) => {
            const [channel] = key.split('_');
            const channelNum = parseInt(channel);
            
            if (!channelSizes.has(channelNum)) {
                channelSizes.set(channelNum, 0);
            }
            
            channelSizes.set(channelNum, channelSizes.get(channelNum) + size);
        });
        
        return {
            totalBytes: this.totalBytesLoaded,
            totalMB: this.totalBytesLoaded / (1024 * 1024),
            channelSizes: channelSizes,
            sampleCount: this.sampleSizes.size,
            averageSampleSize: this.sampleSizes.size > 0 ? 
                this.totalBytesLoaded / this.sampleSizes.size : 0
        };
    }

    getStatus() {
        let totalSamples = 0;
        this.channelSamples.forEach(channelMap => {
            totalSamples += channelMap.size;
        });
        
        return {
            initialized: this.context !== null,
            enabled: this.enabled,
            loading: this.loading,
            samplesLoaded: totalSamples,
            channels: this.channelSamples.size,
            activeSounds: this.activeSounds.size,
            volume: this.volume,
            state: this.context?.state,
            totalBytes: this.totalBytesLoaded,
            sizeFormatted: this.getLoadedSizeFormatted()
        };
    }
}