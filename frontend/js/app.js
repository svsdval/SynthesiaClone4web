class SynthesiaApp {
    constructor() {
        this.midiData = null;
        this.playing = false;
        this.paused = false;
        this.currentTime = 0;
        this.totalTime = 0;
        this.lastTimestamp = 0;
        this.animationId = null;
        
        this.piano = null;
        this.renderer = null;
        this.controls = null;
        
        this.scrollSpeed = 200;
        this.playSpeed = 1.0;

        this.channelSettings = new Map();
        this.webMIDI = null;
        
        this.selectedMIDIInputs = new Set();
        this.selectedMIDIOutputs = new Set();
        this.selectedMIDILighting = null; // Устройство для подсветки
        this.midiInputDevices = new Map();
        this.midiOutputDevices = new Map();
        this.midiLightingDevice = null;
        
        this.activePlaybackNotes = new Map();
        this.pressedKeys = new Set();
        this.userPressedNotes = new Map();
        this.waitingNotes = new Map();
        this.litNotes = new Map(); // Ноты с подсветкой: pitch -> channel
        
        this.noteIndex = 0;
        this.programsSet = false;
        this.resizeTimeout = null;
        
        this.earlyPressTolerance = 0.5;
        
        // Настройки подсветки
        this.lightingEnabled = false;
        this.lightingUseAllChannels = true;
        this.lightingChannel = 0;
        this.lightingProgram = 0;

        this.settingsManager = new SettingsManager();
        this.savedChannelColors = null;

        this.lastStuckNoteCheck = 0;

        // Audio Engine для воспроизведения без MIDI
        this.audioEngine = new AudioEngine();
        this.useAudioEngine = false;
        this.audioEngineSoundsMap = new Map(); // Для отслеживания soundId

        this.checkURLParams();
        this.init();
    }
    
    async init() {
        try {
            const savedSettings = this.settingsManager.loadSettings();
            if (savedSettings) {
                this.settingsManager.applySettings(this, savedSettings);
            }
            
            this.piano = new PianoKeyboard('piano-keyboard');
            this.renderer = new NotesRenderer('notes-canvas', this.piano);
            this.controls = new Controls(this);
            
            this.setupEventListeners();
            
            setTimeout(() => {
                this.resize();
                
                if (this.urlMidiFile) {
                    setTimeout(() => {
                        this.loadMIDIFromURL();
                    }, 500);
                }
            }, 200);
            
            window.addEventListener('resize', () => this.resize());
            
            window.addEventListener('beforeunload', () => {
                this.settingsManager.saveSettings(this);
                this.cleanup();
            });
            
            // НОВОЕ: Инициализируем Audio Engine
            await this.audioEngine.initialize();
            await this.audioEngine.checkAvailableSamples();
            
            await this.initWebMIDI();
            
            if (savedSettings) {
                setTimeout(() => {
                    this.settingsManager.restoreMIDIDevices(this, savedSettings);
                    
                    // НОВОЕ: Проверяем нужно ли использовать Audio Engine
                    this.checkAudioEngineNeeded();
                }, 500);
            }
            
            console.log('Synthesia Web App initialized successfully');
        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Failed to initialize application: ' + error.message);
        }
    }
    setupEventListeners() {
        document.getElementById('btn-play').addEventListener('click', () => this.play());
        document.getElementById('btn-pause').addEventListener('click', () => this.pause());
        document.getElementById('btn-stop').addEventListener('click', () => this.stop());

        
        document.getElementById('btn-open-file').addEventListener('click', () => {
            this.controls.showFileModal();
        });
        
        document.getElementById('btn-upload').addEventListener('click', () => {
            this.controls.showUploadModal();
        });
        
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.controls.showSettingsModal();
        });
        
        document.getElementById('btn-channels').addEventListener('click', () => {
            this.controls.showChannelsModal();
        });
        
        document.getElementById('btn-lighting').addEventListener('click', () => {
            this.controls.showLightingModal();
        });

        document.getElementById('btn-share-copy').addEventListener('click', () => {
            this.copyShareLink();
        });

        document.getElementById('btn-share').addEventListener('click', () => {
        this.controls.showShareModal();
        });

        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', (e) => {
            this.scrollSpeed = parseInt(e.target.value);
            document.getElementById('speed-value').textContent = `${this.scrollSpeed} px/s`;
            this.renderer.setScrollSpeed(this.scrollSpeed);
        });

        const playSpeedSlider = document.getElementById('play-speed-slider');
        playSpeedSlider.addEventListener('input', (e) => {
            this.playSpeed = parseInt(e.target.value) *0.01;
            document.getElementById('play-speed-value').textContent = `${ Math.floor(this.playSpeed * 100) }%`;
        });
        
        document.getElementById('btn-seek-back').addEventListener('click', () => {
            this.seek(this.currentTime - 10);
        });
        
        document.getElementById('btn-seek-forward').addEventListener('click', () => {
            this.seek(this.currentTime + 10);
        });
        
        document.getElementById('btn-fullscreen').addEventListener('click', () => {
            this.toggleFullscreen();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    if (this.playing && !this.paused) {
                        this.pause();
                    } else {
                        this.play();
                    }
                    break;
                case 'KeyS':
                    e.preventDefault();
                    this.stop();
                    break;
                case 'KeyR':
                    e.preventDefault();
                    this.stop();
                    setTimeout(() => this.play(), 100);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.seek(this.currentTime - 10);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.seek(this.currentTime + 10);
                    break;
                case 'Equal':
                case 'NumpadAdd':
                    e.preventDefault();
                    this.adjustSpeed(20);
                    break;
                case 'Minus':
                case 'NumpadSubtract':
                    e.preventDefault();
                    this.adjustSpeed(-20);
                    break;
                case 'KeyM':
                    e.preventDefault();
                    this.controls.showChannelsModal();
                    break;
                case 'KeyO':
                    e.preventDefault();
                    this.controls.showFileModal();
                    break;
                case 'KeyD':
                    e.preventDefault();
                    this.controls.showSettingsModal();
                    break;
                case 'KeyL':
                    e.preventDefault();
                    this.controls.showLightingModal();
                    break;
                case 'KeyP':
                    // Panic button - останавливает все ноты
                    e.preventDefault();
                    console.log('PANIC: Stopping all notes!');
                    this.sendAllNotesOff();
                    this.stopAllPlaybackNotes();
                    this.clearAllLighting();
                    
                    const statusText = document.getElementById('status-text');
                    const oldText = statusText.textContent;
                    statusText.textContent = '⚠️ PANIC - All notes stopped!';
                    statusText.style.color = '#ff6464';
                    
                    setTimeout(() => {
                        statusText.textContent = oldText;
                        statusText.style.color = '';
                    }, 2000);
                    break;

                case 'KeyI':
                    // Debug info
                    e.preventDefault();
                    this.debugActiveNotes();
                    break;                    
            }
        });

        document.getElementById('btn-panic').addEventListener('click', () => {
            console.log('PANIC button pressed!');
            this.sendAllNotesOff();
            this.stopAllPlaybackNotes();
            this.clearAllLighting();
            
            const statusText = document.getElementById('status-text');
            const oldText = statusText.textContent;
            statusText.textContent = '⚠️ All notes stopped!';
            statusText.style.color = '#ff6464';
            
            setTimeout(() => {
                statusText.textContent = oldText;
                statusText.style.color = '';
            }, 2000);
        });        
    }
    
    async initWebMIDI() {
        if (!navigator.requestMIDIAccess) {
            console.warn('Web MIDI API not supported in this browser');
            return false;
        }
        
        try {
            this.webMIDI = await navigator.requestMIDIAccess({ sysex: false });
            console.log('Web MIDI initialized');
            
            this.updateMIDIDevices();
            
            this.webMIDI.onstatechange = () => {
                console.log('MIDI devices changed');
                this.updateMIDIDevices();
                if (this.controls) {
                    this.controls.updateMIDIDevicesUI();
                }
            };
            
            return true;
        } catch (error) {
            console.error('Web MIDI initialization failed:', error);
            return false;
        }
    }
    
    updateMIDIDevices() {
        if (!this.webMIDI) return;
        
        this.midiInputDevices.clear();
        this.midiOutputDevices.clear();
        
        for (const input of this.webMIDI.inputs.values()) {
            this.midiInputDevices.set(input.id, input);
        }
        
        for (const output of this.webMIDI.outputs.values()) {
            this.midiOutputDevices.set(output.id, output);
        }
        
        console.log(`Found ${this.midiInputDevices.size} MIDI inputs, ${this.midiOutputDevices.size} MIDI outputs`);
    }
    
    setMIDIInput(deviceId, enabled) {
        const device = this.midiInputDevices.get(deviceId);
        if (!device) return;
        
        if (enabled) {
            this.selectedMIDIInputs.add(deviceId);
            device.onmidimessage = (message) => this.handleMIDIInput(message);
            console.log(`Enabled MIDI input: ${device.name}`);
        } else {
            this.selectedMIDIInputs.delete(deviceId);
            device.onmidimessage = null;
            console.log(`Disabled MIDI input: ${device.name}`);
        }
    }
    
    setMIDIOutput(deviceId, enabled) {
        if (enabled) {
            this.selectedMIDIOutputs.add(deviceId);
            console.log(`Enabled MIDI output: ${this.midiOutputDevices.get(deviceId)?.name}`);
        } else {
            this.selectedMIDIOutputs.delete(deviceId);
            console.log(`Disabled MIDI output: ${this.midiOutputDevices.get(deviceId)?.name}`);
        }
    }
    
    setMIDILighting(deviceId, enabled) {
        if (enabled && deviceId) {
            const device = this.midiOutputDevices.get(deviceId);
            if (device) {
                this.selectedMIDILighting = deviceId;
                this.midiLightingDevice = device;
                this.lightingEnabled = true;
                console.log(`Enabled MIDI lighting: ${device.name}`);
                
                // Устанавливаем программу для подсветки
                this.setupLightingPrograms();
            }
        } else {
            this.selectedMIDILighting = null;
            this.midiLightingDevice = null;
            this.lightingEnabled = false;
            this.clearAllLighting();
            console.log('Disabled MIDI lighting');
        }
    }
    
    setupLightingPrograms() {
        if (!this.midiLightingDevice || !this.lightingEnabled) return;
        
        console.log('Setting up lighting programs...');
        
        if (this.lightingUseAllChannels) {
            this.channelSettings.forEach((settings, channel) => {
                const programChange = [0xC0 | channel, settings.program || 0];
                this.sendLightingMessage(programChange);
                console.log(`Lighting: Set channel ${channel} to program ${settings.program || 0}`);
            });
        } else {
            const programChange = [0xC0 | this.lightingChannel, this.lightingProgram];
            this.sendLightingMessage(programChange);
            console.log(`Lighting: Set channel ${this.lightingChannel} to program ${this.lightingProgram}`);
        }
    }
    
    sendLightingMessage(data) {
        if (!this.midiLightingDevice || !this.lightingEnabled) return;
        
        try {
            this.midiLightingDevice.send(data);
        } catch (error) {
            console.error('Error sending lighting MIDI:', error);
        }
    }
    
    sendLightingNoteOn(pitch, channel = 0) {
        if (!this.lightingEnabled) return;
        
        // Сначала выключаем если уже горит
        if (this.litNotes.has(pitch)) {
            const oldChannel = this.litNotes.get(pitch);
            this.sendLightingNoteOff(pitch, oldChannel);
        }
        
        // Включаем подсветку
        if (this.lightingUseAllChannels) {
            this.sendLightingMessage([0x90 | channel, pitch, 1]);
        } else {
            this.sendLightingMessage([0x90 | this.lightingChannel, pitch, 1]);
        }
        
        this.litNotes.set(pitch, channel);
    }
    
    sendLightingNoteOff(pitch, channel = null) {
        if (!this.lightingEnabled) return;
        
        if (!this.litNotes.has(pitch)) return;
        
        const noteChannel = channel !== null ? channel : this.litNotes.get(pitch);
        
        if (this.lightingUseAllChannels) {
            this.sendLightingMessage([0x80 | noteChannel, pitch, 0]);
        } else {
            this.sendLightingMessage([0x80 | this.lightingChannel, pitch, 0]);
        }
        
        this.litNotes.delete(pitch);
    }
    
    clearAllLighting() {
        if (!this.lightingEnabled) return;
        
        this.litNotes.forEach((channel, pitch) => {
            this.sendLightingNoteOff(pitch, channel);
        });
        
        this.litNotes.clear();
    }
    
    handleMIDIInput(message) {
        const [status, note, velocity] = message.data;
        const command = status & 0xF0;
        const channel = status & 0x0F;
        
        if (command === 0x90 && velocity > 0) {
            // Note On
            this.pressedKeys.add(note);
            this.piano.setKeyActive(note, true);
            
            // Записываем время нажатия пользователем
            this.userPressedNotes.set(note, this.currentTime);
            
            const learningMode = this.isLearningMode();
            
            if (learningMode && this.playing) {
                // В режиме обучения проверяем ожидающие ноты
                if (this.waitingNotes.has(note)) {
                    console.log(`✓ Correct note in learning mode: ${note}`);
                    
                    const noteData = this.waitingNotes.get(note);
                    
                    // Воспроизводим ноту
                    this.sendMIDIMessage([0x90 | noteData.channel, note, noteData.velocity]);
                    
                    // ИСПРАВЛЕНИЕ: Используем уникальный ключ и сохраняем все данные
                    const noteKey = `${note}_${noteData.channel}_${noteData.startTime}`;
                    
                    this.activePlaybackNotes.set(noteKey, {
                        pitch: note,
                        channel: noteData.channel,
                        velocity: noteData.velocity,
                        endTime: noteData.endTime,
                        startTime: noteData.startTime,
                        fromLearning: true // НОВОЕ: Помечаем что нота из режима обучения
                    });
                    
                    // Выключаем подсветку когда нота нажата
                    this.sendLightingNoteOff(note);
                    
                    this.waitingNotes.delete(note);
                    this.updateLearningIndicator();
                }
                // ВАЖНО: В режиме обучения НЕ отправляем ноту если её нет в ожидающих
            } else {
                // В обычном режиме просто играем ноту
                this.sendMIDIMessage([status, note, velocity]);
            }
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            // Note Off
            this.pressedKeys.delete(note);
            this.userPressedNotes.delete(note);
            this.piano.setKeyActive(note, false);
            
            // ИСПРАВЛЕНИЕ: В режиме обучения НЕ отправляем Note Off вручную
            // Ноты из режима обучения останавливаются автоматически по endTime
            const learningMode = this.isLearningMode();
            
            if (!learningMode || !this.playing) {
                // Только в обычном режиме отправляем Note Off
                this.sendMIDIMessage([0x80, note, 0]);
            } else {
                console.log(`Note Off from user in learning mode: ${note} (will stop automatically at end time)`);
            }
        }
    }
    
    sendMIDIMessage(data) {
        const [status, note, velocity] = data;
        const command = status & 0xF0;
        const channel = status & 0x0F;
        
        // Отправляем на MIDI устройства
        if (this.selectedMIDIOutputs.size > 0) {
            for (const outputId of this.selectedMIDIOutputs) {
                const output = this.midiOutputDevices.get(outputId);
                if (output && output.state === 'connected') {
                    try {
                        output.send(data);
                    } catch (error) {
                        console.error('Error sending MIDI:', error);
                    }
                }
            }
        }
        
        // Воспроизводим через Audio Engine если включен
        if (this.useAudioEngine && this.audioEngine.enabled) {
            if (command === 0x90 && velocity > 0) {
                // Note On
                const soundId = this.audioEngine.playNote(note, velocity);
                if (soundId) {
                    this.audioEngineSoundsMap.set(`${note}_${channel}`, soundId);
                }
            } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
                // Note Off
                const key = `${note}_${channel}`;
                const soundId = this.audioEngineSoundsMap.get(key);
                if (soundId) {
                    this.audioEngine.stopNote(note, soundId);
                    this.audioEngineSoundsMap.delete(key);
                } else {
                    // Останавливаем все звуки этой ноты
                    this.audioEngine.stopNote(note);
                }
            }
        }
    }
    
    setupChannelPrograms() {
        if (!this.channelSettings.size) return;
        
        console.log('Setting up channel programs...');
        
        this.channelSettings.forEach((settings, channel) => {
            const program = settings.program || 0;
            const programChange = [0xC0 | channel, program];
            this.sendMIDIMessage(programChange);
            console.log(`Set channel ${channel} to program ${program}`);
        });
        this.programsSet = true;
    }

    saveCurrentSettings() {
        const success = this.settingsManager.saveSettings(this);
        if (success) {
            const statusText = document.getElementById('status-text');
            const oldText = statusText.textContent;
            statusText.textContent = '✓ Settings saved!';
            statusText.style.color = '#64c896';
            
            setTimeout(() => {
                statusText.textContent = oldText;
                statusText.style.color = '';
            }, 2000);
        }
    }
    
    isLearningMode() {
        let hasLearning = false;
        this.channelSettings.forEach(settings => {
            if (settings.learning) hasLearning = true;
        });
        return hasLearning;
    }
    
    async loadMIDI(path, updateURL = true) {
        try {
            document.getElementById('status-text').textContent = 'Loading...';
            
            if (this.playing) {
                this.stop();
            } else {
                this.sendAllNotesOff();
                this.clearAllLighting();
            }
            
            const response = await fetch(`http://localhost:5000/api/parse/${encodeURIComponent(path)}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.midiData = data;
                this.totalTime = data.total_time;
                this.currentTime = 0;
                this.noteIndex = 0;
                this.programsSet = false;
                this.waitingNotes.clear();
                this.userPressedNotes.clear();
                this.activePlaybackNotes.clear();
                
                this.setupChannels(data.channels, data.channel_programs || {}, data.channel_banks || {});
                this.piano.calculateLayout(data.notes);
                this.renderer.setNotes(data.notes, this.channelSettings);
                this.renderer.updatePlayLinePosition();
                
                this.updateTimeDisplay();
                this.updateProgress();
                
                setTimeout(() => {
                    this.renderer.render(0);
                }, 100);
                
                document.getElementById('status-text').textContent = 'Ready';
                
                // НОВОЕ: Обновляем URL
                if (updateURL) {
                    this.updateURL(path);
                }
                
                // Сохраняем текущий путь для шаринга
                this.currentMIDIPath = path;
                
                console.log(`Loaded: ${data.notes.length} notes, ${data.total_time.toFixed(2)}s, channels: ${data.channels.join(',')}`);
                console.log('Channel programs:', data.channel_programs);
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        } catch (error) {
            console.error('Error loading MIDI:', error);
            this.showError('Failed to load MIDI file: ' + error.message);
            document.getElementById('status-text').textContent = 'Error';
        }
    }

    
    cleanup() {
        console.log('Cleaning up...');
        
        // Останавливаем воспроизведение
        if (this.playing) {
            this.stop();
        }
        
        // Отправляем All Notes Off на всякий случай
        this.sendAllNotesOff();
        this.clearAllLighting();
        
        console.log('Cleanup complete');
    }

    setupChannels(channels, channelPrograms = {},channelBanks = {}) {
        const defaultColors = [
            '#64ff64', '#64c8ff', '#ffc864', '#ff64ff',
            '#ffff64', '#96ffa0', '#9696ff', '#ff9696',
            '#c864ff', '#64ffc8', '#ff9664', '#c8ff64',
            '#6496ff', '#ff6496', '#96ffff', '#ffc8c8'
        ];
        
        this.channelSettings.clear();
        
        channels.forEach(ch => {
            // ИСПРАВЛЕНИЕ: Используем программу из channelPrograms
            const program = channelPrograms[ch] !== undefined ? channelPrograms[ch] : 0;
            const bank = channelBanks[ch] !== undefined ? channelBanks[ch].msb : 0;
            const isplayback = bank !== 128 ? true : false;

            
            this.channelSettings.set(ch, {
                visible: isplayback,
                playback: isplayback,
                learning: false,
                program: program,  // Используем реальную программу из MIDI файла
                color: defaultColors[ch % defaultColors.length],

                bank : bank,
                suffix : isplayback ? '' : 'drums'

            });
            
            console.log(`Channel ${ch} setup with program ${program} and bank ${bank}`);
        });
        
        console.log(`Setup ${channels.length} channels with programs:`, channelPrograms);
    }    

    play() {
        if (!this.midiData) {
            this.showError('Please load a MIDI file first');
            return;
        }
        
        // ИСПРАВЛЕНИЕ 2: Всегда сбрасываем флаг и устанавливаем программы заново
        this.programsSet = false;
        this.setupChannelPrograms();
        this.setupLightingPrograms();
        
        this.playing = true;
        this.paused = false;
        this.lastTimestamp = performance.now();
        
        const learningChannels = [];
        this.channelSettings.forEach((settings, channel) => {
            if (settings.learning) {
                learningChannels.push(channel);
            }
        });
        
        if (learningChannels.length > 0) {
            console.log(`🎓 Learning mode enabled for channels: ${learningChannels.join(', ')}`);
            document.getElementById('status-text').textContent = 'Learning Mode';
        } else {
            document.getElementById('status-text').textContent = 'Playing';
        }
        
        document.getElementById('btn-play').disabled = true;
        document.getElementById('btn-pause').disabled = false;
        document.getElementById('btn-stop').disabled = false;
        
        this.animate();
    }
    
    pause() {
        this.paused = !this.paused;
        
        if (this.paused) {
            document.getElementById('status-text').textContent = 'Paused';
            
            // ИСПРАВЛЕНИЕ 1: При паузе останавливаем все ноты
            this.stopAllPlaybackNotes();
            this.sendAllNotesOff();
            this.clearAllLighting();
        } else {
            // ИСПРАВЛЕНИЕ 2: При продолжении устанавливаем программы заново
            this.programsSet = false;
            this.setupChannelPrograms();
            this.setupLightingPrograms();
            
            const learningMode = this.isLearningMode();
            document.getElementById('status-text').textContent = learningMode ? 'Learning Mode' : 'Playing';
            this.lastTimestamp = performance.now();
            this.animate();
        }
    }
    
    stop() {
        this.playing = false;
        this.paused = false;
        this.currentTime = 0;
        this.noteIndex = 0;
        this.waitingNotes.clear();
        this.userPressedNotes.clear(); // ВАЖНО: Очищаем нажатые пользователем ноты
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.stopAllPlaybackNotes();
        this.sendAllNotesOff();
        this.clearAllLighting();
        
        document.getElementById('btn-play').disabled = false;
        document.getElementById('btn-pause').disabled = true;
        document.getElementById('btn-stop').disabled = true;
        document.getElementById('status-text').textContent = 'Stopped';
        document.getElementById('learning-indicator').textContent = '';
        
        this.updateTimeDisplay();
        this.updateProgress();
        this.renderer.render(this.currentTime);
        this.piano.clearActive();
        
        this.programsSet = false;
    }

    checkForStuckNotes() {
        const maxNoteLength = 30; // 30 секунд - максимальная длина ноты
        const stuckNotes = [];
        
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            const noteLength = this.currentTime - noteData.startTime;
            
            // Проверяем зависшие ноты
            if (noteLength > maxNoteLength) {
                stuckNotes.push(noteKey);
                console.warn(`Detected stuck note: ${noteData.pitch} (${this.getNoteName(noteData.pitch)}) playing for ${noteLength.toFixed(1)}s`);
            }
            
            // НОВОЕ: Проверяем ноты из режима обучения которые играют после отпускания клавиши
            if (noteData.fromLearning && !this.pressedKeys.has(noteData.pitch)) {
                const timeSinceRelease = noteLength - (noteData.endTime - noteData.startTime);
                if (timeSinceRelease > 0.5) { // Играет 0.5с после отпускания
                    stuckNotes.push(noteKey);
                    console.warn(`Detected stuck learning note: ${noteData.pitch} still playing after key release`);
                }
            }
        });
        
        // Останавливаем зависшие ноты
        stuckNotes.forEach(noteKey => {
            const noteData = this.activePlaybackNotes.get(noteKey);
            const noteOff = [0x80 | noteData.channel, noteData.pitch, 0];
            this.sendMIDIMessage(noteOff);
            this.activePlaybackNotes.delete(noteKey);
            console.log(`Force stopped stuck note: ${noteData.pitch}`);
        });
    }
    
    debugActiveNotes() {
        console.log('=== Active Notes Debug ===');
        console.log(`Total active notes: ${this.activePlaybackNotes.size}`);
        console.log(`Pressed keys: ${Array.from(this.pressedKeys).join(', ')}`);
        console.log(`Waiting notes: ${this.waitingNotes.size}`);
        
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            const duration = this.currentTime - noteData.startTime;
            const remaining = noteData.endTime - this.currentTime;
            const keyPressed = this.pressedKeys.has(noteData.pitch) ? '🎹' : '  ';
            const learningFlag = noteData.fromLearning ? '[LEARNING]' : '';
            
            console.log(`  ${keyPressed} ${this.getNoteName(noteData.pitch)} (${noteData.pitch}) on ch${noteData.channel} ${learningFlag}: ` +
                      `duration=${duration.toFixed(2)}s, remaining=${remaining.toFixed(2)}s`);
        });
        
        console.log('========================');
    }

    stopAllPlaybackNotes() {
        console.log(`Stopping ${this.activePlaybackNotes.size} active playback notes...`);
        
        // Останавливаем отслеживаемые активные ноты
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            const noteOff = [0x80 | noteData.channel, noteData.pitch, 0];
            this.sendMIDIMessage(noteOff);
            console.log(`Stopped: ${noteData.pitch} on channel ${noteData.channel}`);
        });
        this.activePlaybackNotes.clear();
    }
    sendAllNotesOff() {
        console.log('Sending All Notes Off to all channels...');
        
        // НОВОЕ: Останавливаем Audio Engine
        if (this.useAudioEngine) {
            this.audioEngine.stopAllNotes();
            this.audioEngineSoundsMap.clear();
        }
        
        // Отправляем на MIDI устройства
        for (let attempt = 0; attempt < 2; attempt++) {
            for (let channel = 0; channel < 16; channel++) {
                this.sendMIDIMessage([0xB0 | channel, 123, 0]);
                this.sendMIDIMessage([0xB0 | channel, 120, 0]);
                this.sendMIDIMessage([0xB0 | channel, 121, 0]);
            }
            
            if (attempt === 0) {
                const start = performance.now();
                while (performance.now() - start < 10) { }
            }
        }
        
        for (let channel = 0; channel < 16; channel++) {
            for (let note = 0; note < 128; note++) {
                this.sendMIDIMessage([0x80 | channel, note, 0]);
            }
        }
        
        console.log('All notes stopped on all channels');
    }
    
    debugActiveNotes() {
        console.log('=== Active Notes Debug ===');
        console.log(`Total active notes: ${this.activePlaybackNotes.size}`);
        
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            const duration = this.currentTime - noteData.startTime;
            const remaining = noteData.endTime - this.currentTime;
            console.log(`  ${this.getNoteName(noteData.pitch)} (${noteData.pitch}) on ch${noteData.channel}: ` +
                      `duration=${duration.toFixed(2)}s, remaining=${remaining.toFixed(2)}s`);
        });
        
        console.log('========================');
    }
    seek(time) {
        this.currentTime = Math.max(0, Math.min(this.totalTime, time));
        this.noteIndex = 0;
        this.waitingNotes.clear();
        
        // ИСПРАВЛЕНИЕ: Более агрессивная остановка всех нот
        this.stopAllPlaybackNotes();
        this.sendAllNotesOff();
        this.clearAllLighting();
        
        // НОВОЕ: Небольшая задержка для гарантии остановки
        setTimeout(() => {
            this.sendAllNotesOff();
        }, 50);
        
        for (let i = 0; i < this.midiData.notes.length; i++) {
            if (this.midiData.notes[i].start_time >= this.currentTime) {
                this.noteIndex = i;
                break;
            }
        }
        
        this.updateTimeDisplay();
        this.updateProgress();
        this.renderer.render(this.currentTime);
        this.updatePianoDisplay();
    }
    
    animate() {
        if (!this.playing || this.paused) return;
        
        const now = performance.now();
        const dt = (now - this.lastTimestamp) / 1000;
        this.lastTimestamp = now;
        
        const learningChannels = new Set();
        this.channelSettings.forEach((settings, channel) => {
            if (settings.learning) {
                learningChannels.add(channel);
            }
        });
        
        const isLearningMode = learningChannels.size > 0;
        
        const actualWaitingNotes = this.getActualWaitingNotes();
        
        if (isLearningMode && actualWaitingNotes.size > 0) {
            // НОВОЕ: Останавливаем отпущенные ноты даже в режиме ожидания
            this.stopUserReleasedNotes();
            
            actualWaitingNotes.forEach((noteData, pitch) => {
                if (!this.litNotes.has(pitch)) {
                    this.sendLightingNoteOn(pitch, noteData.channel);
                }
            });
            
            const activeNotes = this.renderer.render(this.currentTime);
            
            const displayNotes = [];
            
            activeNotes.forEach(note => {
                if (!this.pressedKeys.has(note.pitch)) {
                    displayNotes.push(note);
                }
            });
            
            this.pressedKeys.forEach(pitch => {
                displayNotes.push({ pitch: pitch, color: '#64c8ff' });
            });
            
            this.piano.updateActiveNotes(displayNotes);
            this.animationId = requestAnimationFrame(() => this.animate());
            return;
        }
        
        this.currentTime += dt *  this.playSpeed;
        
        if (this.currentTime >= this.totalTime) {
            this.stop();
            return;
        }
        
        this.updateTimeDisplay();
        this.updateProgress();
        
        this.processNotes(isLearningMode, learningChannels);
        
        // НОВОЕ: В режиме обучения также проверяем отпущенные ноты
        if (isLearningMode) {
            this.stopUserReleasedNotes();
        }
        
        if (!this.lastStuckNoteCheck || now - this.lastStuckNoteCheck > 1000) {
            this.checkForStuckNotes();
            this.lastStuckNoteCheck = now;
        }
        
        const activeNotes = this.renderer.render(this.currentTime);
        
        const displayNotes = [];
        
        activeNotes.forEach(note => {
            if (!this.pressedKeys.has(note.pitch)) {
                displayNotes.push(note);
            }
        });
        
        this.pressedKeys.forEach(pitch => {
            displayNotes.push({ pitch: pitch, color: '#64c8ff' });
        });
        
        this.piano.updateActiveNotes(displayNotes);
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }
    
    getActualWaitingNotes() {
        const actualWaiting = new Map();
        
        this.waitingNotes.forEach((noteData, pitch) => {
            // Проверяем, была ли эта нота нажата пользователем заранее
            if (this.userPressedNotes.has(pitch)) {
                const pressTime = this.userPressedNotes.get(pitch);
                const noteStartTime = noteData.startTime || this.currentTime;
                
                // Если нота нажата заранее в пределах толерантности
                if (noteStartTime - pressTime <= this.earlyPressTolerance) {
                    console.log(`Note ${pitch} was pressed early (${(noteStartTime - pressTime).toFixed(2)}s before), accepting it`);
                    
                    // Воспроизводим ноту
                    this.sendMIDIMessage([0x90 | noteData.channel, pitch, noteData.velocity]);
                    
                    // ИСПРАВЛЕНИЕ: Используем уникальный ключ
                    const noteKey = `${pitch}_${noteData.channel}_${noteData.startTime}`;
                    
                    this.activePlaybackNotes.set(noteKey, {
                        pitch: pitch,
                        channel: noteData.channel,
                        velocity: noteData.velocity,
                        endTime: noteData.endTime,
                        startTime: noteData.startTime
                    });
                    
                    this.sendLightingNoteOff(pitch);
                    
                    // Не добавляем в actualWaiting - нота уже нажата
                    return;
                }
            }
            
            // Нота действительно ожидается
            actualWaiting.set(pitch, noteData);
        });
        
        // Обновляем waitingNotes
        this.waitingNotes = actualWaiting;
        
        return actualWaiting;
    }
    
    processNotes(isLearningMode, learningChannels) {
        if (!this.midiData || !this.midiData.notes) return;
        
        // Обрабатываем новые ноты
        while (this.noteIndex < this.midiData.notes.length) {
            const note = this.midiData.notes[this.noteIndex];
            
            if (note.start_time > this.currentTime) {
                break;
            }
            
            const settings = this.channelSettings.get(note.channel);
            if (!settings || !settings.playback) {
                this.noteIndex++;
                continue;
            }
            
            if (isLearningMode && learningChannels.has(note.channel)) {
                this.waitingNotes.set(note.pitch, {
                    channel: note.channel,
                    velocity: note.velocity,
                    endTime: note.end_time,
                    startTime: note.start_time
                });
                console.log(`📝 Added note to waiting: ${note.pitch} (${this.getNoteName(note.pitch)}) at ${note.start_time.toFixed(2)}s`);
            } else {
                const noteOn = [0x90 | note.channel, note.pitch, note.velocity];
                this.sendMIDIMessage(noteOn);
                
                const noteKey = `${note.pitch}_${note.channel}_${note.start_time}`;
                
                this.activePlaybackNotes.set(noteKey, {
                    pitch: note.pitch,
                    channel: note.channel,
                    velocity: note.velocity,
                    endTime: note.end_time,
                    startTime: note.start_time,
                    fromLearning: false
                });
            }
            
            this.noteIndex++;
        }
        
        // ИСПРАВЛЕНИЕ: Останавливаем закончившиеся ноты
        const notesToStop = [];
        const stopBuffer = 0.05;
        
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            // Останавливаем если:
            // 1. Время вышло
            // 2. ИЛИ если это нота из режима обучения и пользователь отпустил клавишу
            const timeExpired = noteData.endTime <= this.currentTime + stopBuffer;
            const learningNoteReleased = noteData.fromLearning && 
                                        !this.pressedKeys.has(noteData.pitch) && 
                                        isLearningMode;
            
            if (timeExpired || learningNoteReleased) {
                notesToStop.push(noteKey);
                
                if (learningNoteReleased) {
                    console.log(`Stopping learning note early (user released): ${noteData.pitch}`);
                }
            }
        });
        
        notesToStop.forEach(noteKey => {
            const noteData = this.activePlaybackNotes.get(noteKey);
            const noteOff = [0x80 | noteData.channel, noteData.pitch, 0];
            this.sendMIDIMessage(noteOff);
            this.activePlaybackNotes.delete(noteKey);
            console.log(`Note OFF: ${noteData.pitch} (${this.getNoteName(noteData.pitch)}) on channel ${noteData.channel}`);
        });
        
        this.updateLearningIndicator();
    }
    
    stopUserReleasedNotes() {
        // Останавливаем ноты которые пользователь отпустил в режиме обучения
        const notesToStop = [];
        
        this.activePlaybackNotes.forEach((noteData, noteKey) => {
            if (noteData.fromLearning && !this.pressedKeys.has(noteData.pitch)) {
                notesToStop.push(noteKey);
            }
        });
        
        notesToStop.forEach(noteKey => {
            const noteData = this.activePlaybackNotes.get(noteKey);
            const noteOff = [0x80 | noteData.channel, noteData.pitch, 0];
            this.sendMIDIMessage(noteOff);
            this.activePlaybackNotes.delete(noteKey);
            console.log(`Stopped released learning note: ${noteData.pitch}`);
        });
    }

    updateLearningIndicator() {
        const indicator = document.getElementById('learning-indicator');
        
        if (this.waitingNotes.size > 0) {
            const notesStr = Array.from(this.waitingNotes.keys())
                .map(n => this.getNoteName(n))
                .join(', ');
            indicator.textContent = `⏸ Waiting for: ${notesStr}`;
            indicator.style.color = '#ffaa00';
        } else if (this.isLearningMode() && this.playing) {
            indicator.textContent = '🎓 Learning Mode Active';
            indicator.style.color = '#64c896';
        } else {
            indicator.textContent = '';
        }
    }
    
    getNoteName(pitch) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(pitch / 12) - 1;
        const note = noteNames[pitch % 12];
        return `${note}${octave}`;
    }
    
    updateTimeDisplay() {
        document.getElementById('current-time').textContent = this.formatTime(this.currentTime);
        document.getElementById('total-time').textContent = this.formatTime(this.totalTime);
    }
    
    updateProgress() {
        const progress = this.totalTime > 0 ? (this.currentTime / this.totalTime) * 100 : 0;
        document.getElementById('progress-fill').style.width = `${progress}%`;
        document.getElementById('progress-handle').style.left = `${progress}%`;
    }
    
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    adjustSpeed(delta) {
        this.scrollSpeed = Math.max(50, Math.min(400, this.scrollSpeed + delta));
        document.getElementById('speed-slider').value = this.scrollSpeed;
        document.getElementById('speed-value').textContent = `${this.scrollSpeed} px/s`;
        this.renderer.setScrollSpeed(this.scrollSpeed);
    }

    adjustPlaySpeed(delta) {
        this.scrollSpeed = Math.max(10, Math.min(400, this.scrollSpeed + delta));
        document.getElementById('play-speed-slider').value = this.scrollSpeed;
        document.getElementById('play-speed-value').textContent = `${this.scrollSpeed} %`;
        this.renderer.setScrollSpeed(this.scrollSpeed);
    }
    
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.error('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }
    
    showError(message) {
        alert(message);
    }
    
    resize() {
        console.log('App resize triggered');
        
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        
        this.resizeTimeout = setTimeout(() => {
            console.log('Executing resize...');
            
            if (this.piano && this.piano.isInitialized) {
                this.piano.resize();
            }
            
            if (this.renderer) {
                this.renderer.resize();
            }
            
            if (this.midiData && !this.playing) {
                setTimeout(() => {
                    if (this.renderer) {
                        this.renderer.render(this.currentTime);
                    }
                }, 100);
            }
        }, 100);
    }

    checkURLParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const midiFile = urlParams.get('midi');
        const autoplay = urlParams.get('autoplay');
        
        if (midiFile) {
            console.log(`URL parameter found: midi=${midiFile}, autoplay=${autoplay}`);
            this.urlMidiFile = decodeURIComponent(midiFile);
            this.urlAutoplay = autoplay === 'true' || autoplay === '1';
        }
    }

    async loadMIDIFromURL() {
        if (!this.urlMidiFile) return;
        
        console.log(`Loading MIDI from URL: ${this.urlMidiFile}`);
        
        try {
            await this.loadMIDI(this.urlMidiFile);
            
            if (this.urlAutoplay) {
                console.log('Auto-playing from URL parameter');
                setTimeout(() => {
                    this.play();
                }, 500);
            }
        } catch (error) {
            console.error('Error loading MIDI from URL:', error);
            this.showError(`Failed to load MIDI file from URL: ${this.urlMidiFile}`);
        }
        
        // Очищаем после использования
        this.urlMidiFile = null;
        this.urlAutoplay = false;
        if (this.useAudioEngine) {
            this.loadAudioSamplesForCurrentMIDI()
        }
    }

    updateURL(midiPath) {
        // Обновляем URL без перезагрузки страницы
        const url = new URL(window.location);
        url.searchParams.set('midi', encodeURIComponent(midiPath));
        window.history.pushState({}, '', url);
    }

    clearURLParams() {
        const url = new URL(window.location);
        url.searchParams.delete('midi');
        url.searchParams.delete('autoplay');
        window.history.pushState({}, '', url);
    }


    copyShareLink() {
        if (!this.currentMIDIPath) {
            this.showError('No MIDI file loaded');
            return;
        }
        
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('midi', encodeURIComponent(this.currentMIDIPath));
        
        // Копируем в буфер обмена
        navigator.clipboard.writeText(url.toString()).then(() => {
            console.log('Share link copied to clipboard:', url.toString());
            
            // Показываем уведомление
            const statusText = document.getElementById('status-text');
            const oldText = statusText.textContent;
            statusText.textContent = '✓ Link copied!';
            statusText.style.color = '#64c896';
            
            setTimeout(() => {
                statusText.textContent = oldText;
                statusText.style.color = '';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showError('Failed to copy link to clipboard');
        });
    }

    getShareLink(withAutoplay = false) {
        if (!this.currentMIDIPath) return null;
        
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('midi', encodeURIComponent(this.currentMIDIPath));
        
        if (withAutoplay) {
            url.searchParams.set('autoplay', 'true');
        }
        
        return url.toString();
    }

    checkAudioEngineNeeded() {
        // Автоматически включаем Audio Engine если нет MIDI выходов
        if (this.selectedMIDIOutputs.size === 0) {
            console.log('No MIDI outputs selected, enabling Audio Engine');
            this.setAudioEngine(true);
        }
    }

    async setAudioEngine(enabled) {
        this.useAudioEngine = enabled;
        this.audioEngine.setEnabled(enabled);
        
        if (enabled && this.midiData && this.audioEngine.samples.size === 0) {
            // Загружаем семплы если еще не загружены
            await this.loadAudioSamplesForCurrentMIDI();
        }
        
        console.log(`Audio Engine ${enabled ? 'enabled' : 'disabled'}`);
    }

    async loadAudioSamplesForCurrentMIDI() {
        if (!this.midiData || !this.midiData.notes) {
            return;
        }
        
        // Собираем уникальные ноты из MIDI
        const uniqueNotes = new Set();
        this.midiData.notes.forEach(note => {
            uniqueNotes.add(note.pitch);
        });
        
        const notesToLoad = Array.from(uniqueNotes).sort((a, b) => a - b);
        
        console.log(`Loading ${notesToLoad.length} audio samples...`);
        
        // Показываем прогресс
        const statusText = document.getElementById('status-text');
        const oldText = statusText.textContent;
        
        await this.audioEngine.preloadSamples(notesToLoad, (loaded, total) => {
            statusText.textContent = `Loading audio: ${loaded}/${total}`;
        });
        
        statusText.textContent = oldText;
        console.log('✓ Audio samples loaded');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM Content Loaded');
        window.app = new SynthesiaApp();
    });
} else {
    console.log('DOM already loaded');
    window.app = new SynthesiaApp();
}
