class Controls {
    constructor(app) {
        this.app = app;
        this.setupModals();
        this.setupProgressBar();
        this.setupAudioEngineControls();
    }
    
    setupModals() {
        const modals = ['file-modal', 'upload-modal', 'channels-modal', 'settings-modal', 'lighting-modal', 'share-modal'];
        
        modals.forEach(modalId => {
            const modal = document.getElementById(modalId);
            const closeBtn = modal.querySelector('.close-btn');
            
            closeBtn.addEventListener('click', () => {
                modal.classList.remove('active');
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });
        
        this.setupUploadModal();
        this.setupLightingModal();
        this.setupShareModal();
        this.setupSettingsButtons();
    }
    
    async showFileModal() {
        const modal = document.getElementById('file-modal');
        const fileList = document.getElementById('file-list');
        
        fileList.innerHTML = '<div class="spinner"></div>';
        modal.classList.add('active');
        
        try {
            const response = await fetch('http://localhost:5000/api/files');
            const data = await response.json();
            
            fileList.innerHTML = '';
            
            if (data.files.length === 0) {
                fileList.innerHTML = '<p style="text-align: center; color: #a0a8b8;">No MIDI files found in ./midi folder</p>';
                return;
            }
            
            data.files.forEach(file => {
                const item = document.createElement('div');
                item.className = 'file-item';
                item.innerHTML = `
                    <span class="file-item-name">${file.name}</span>
                    <span class="file-item-size">${(file.size / 1024).toFixed(1)} KB</span>
                `;
                item.addEventListener('click', () => {
                    modal.classList.remove('active');
                    this.app.loadMIDI(file.path);
                });
                fileList.appendChild(item);
            });
        } catch (error) {
            console.error('Error loading files:', error);
            fileList.innerHTML = '<p style="color: #ff6464;">Error loading files. Make sure backend server is running.</p>';
        }
    }
    
    setupUploadModal() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const selectBtn = document.getElementById('btn-select-file');
        
        selectBtn.addEventListener('click', () => {
            fileInput.click();
        });
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.uploadFile(e.target.files[0]);
            }
        });
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            
            if (e.dataTransfer.files.length > 0) {
                this.uploadFile(e.dataTransfer.files[0]);
            }
        });
    }
    
    async uploadFile(file) {
        const statusDiv = document.getElementById('upload-status');
        statusDiv.innerHTML = '<div class="spinner"></div>';
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('http://localhost:5000/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                statusDiv.innerHTML = '<p style="color: #64c896;">✓ Upload successful!</p>';
                
                setTimeout(() => {
                    document.getElementById('upload-modal').classList.remove('active');
                }, 1000);
                
                this.app.midiData = data;
                this.app.totalTime = data.total_time;
                this.app.currentTime = 0;
                this.app.renderer.setMidiName(`Uploaded: ${file.name}`);
                this.app.notes = data.notes;
                
                // ИСПРАВЛЕНИЕ: Передаем channel_programs в setupChannels
                this.app.setupChannels(data.channels, data.channel_programs || {});
                this.app.piano.calculateLayout(data.notes, this.app.channelSettings);
                this.app.renderer.setNotes(data.notes, this.app.channelSettings);
                this.app.renderer.updatePlayLinePosition();
                
                this.app.updateTimeDisplay();
                document.getElementById('status-text').textContent = 'Ready';
                
                setTimeout(() => {
                    this.app.renderer.render(0);
                }, 100);
                
                console.log(`Uploaded and loaded ${data.notes.length} notes`);
                console.log('Channel programs:', data.channel_programs);
            } else {
                statusDiv.innerHTML = `<p style="color: #ff6464;">Error: ${data.error}</p>`;
            }
        } catch (error) {
            console.error('Upload error:', error);
            statusDiv.innerHTML = '<p style="color: #ff6464;">Upload failed. Make sure backend server is running.</p>';
        }
    }    
    showUploadModal() {
        document.getElementById('upload-modal').classList.add('active');
        document.getElementById('upload-status').innerHTML = '';
    }
    
    showChannelsModal() {
        if (!this.app.channelSettings || this.app.channelSettings.size === 0) {
            alert('Please load a MIDI file first');
            return;
        }
        
        const modal = document.getElementById('channels-modal');
        const channelsList = document.getElementById('channels-list');
        
        channelsList.innerHTML = '';
        
        this.app.channelSettings.forEach((settings, channel) => {
            const item = document.createElement('div');
            item.className = 'channel-item';
            
            item.innerHTML = `
                <span class="channel-label">Ch ${channel} ${settings.suffix}</span>
                <div class="channel-controls">
                    <label>
                        <input type="checkbox" class="ch-visible" ${settings.visible ? 'checked' : ''}>
                        Visible
                    </label>
                    <label>
                        <input type="checkbox" class="ch-playback" ${settings.playback ? 'checked' : ''}>
                        Playback
                    </label>
                    <label>
                        <input type="checkbox" class="ch-learning" ${settings.learning ? 'checked' : ''}>
                        Learning
                    </label>
                    <input type="color" class="color-picker" value="${settings.color}">
                </div>
            `;
            
            const visibleCb = item.querySelector('.ch-visible');
            const playbackCb = item.querySelector('.ch-playback');
            const learningCb = item.querySelector('.ch-learning');
            const colorPicker = item.querySelector('.color-picker');
            
            visibleCb.addEventListener('change', () => {
                settings.visible = visibleCb.checked;

                if (this.app.playing) {
                    this.app.renderer.render(this.app.currentTime);
                }
                // Автоматически подгоняем размер клавиатуры под видимые ноты
                this.app.piano.calculateLayout(this.app.notes, this.app.channelSettings);
                this.app.renderer.render(this.app.currentTime);

            });
            
            playbackCb.addEventListener('change', () => {
                settings.playback = playbackCb.checked;
            });
            
            learningCb.addEventListener('change', () => {
                if (learningCb.checked) {
                    //this.app.channelSettings.forEach((s, ch) => {
                    //    if (ch !== channel) {
                    //        s.learning = false;
                    //    }
                    //});
                    settings.learning = true;
                    this.showChannelsModal();
                } else {
                    settings.learning = false;
                }
                
                this.updateLearningIndicator();
            });
            
            colorPicker.addEventListener('input', () => {
                settings.color = colorPicker.value;
                if (this.app.playing) {
                    this.app.renderer.render(this.app.currentTime);
                }
            });
            
            channelsList.appendChild(item);
        });
        
        modal.classList.add('active');
    }
    
    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        this.updateMIDIDevicesUI();
        modal.classList.add('active');
    }
    
    showLightingModal() {
        const modal = document.getElementById('lighting-modal');
        
        // Обновляем UI
        document.getElementById('lighting-enabled').checked = this.app.lightingEnabled;
        document.getElementById('lighting-all-channels').checked = this.app.lightingUseAllChannels;
        document.getElementById('lighting-channel').value = this.app.lightingChannel;
        document.getElementById('lighting-program').value = this.app.lightingProgram;
        
        // Обновляем список устройств подсветки
        this.updateLightingDevicesUI();
        
        modal.classList.add('active');
    }
    
    updateLightingDevicesUI() {
        const lightingList = document.getElementById('lighting-devices-list');
        
        if (!this.app.webMIDI) {
            lightingList.innerHTML = '<p style="color: #ff6464;">Web MIDI not available</p>';
            return;
        }
        
        lightingList.innerHTML = '<h3 style="margin-bottom: 10px;">Lighting Device</h3>';
        
        if (this.app.midiOutputDevices.size === 0) {
            lightingList.innerHTML += '<p style="color: #a0a8b8; font-size: 14px;">No MIDI output devices found</p>';
        } else {
            this.app.midiOutputDevices.forEach((device, id) => {
                const isSelected = this.app.selectedMIDILighting === id;
                
                const deviceItem = document.createElement('div');
                deviceItem.className = 'midi-device-item';
                deviceItem.innerHTML = `
                    <label>
                        <input type="radio" name="lighting-device" class="midi-lighting-rb" data-device-id="${id}" ${isSelected ? 'checked' : ''}>
                        <span>${device.name}</span>
                        ${device.manufacturer ? `<span style="color: #a0a8b8; font-size: 12px;"> (${device.manufacturer})</span>` : ''}
                    </label>
                `;
                
                const radio = deviceItem.querySelector('.midi-lighting-rb');
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        this.app.setMIDILighting(id, true);
                    }
                });
                
                lightingList.appendChild(deviceItem);
            });
            
            // Опция "None"
            const noneItem = document.createElement('div');
            noneItem.className = 'midi-device-item';
            noneItem.innerHTML = `
                <label>
                    <input type="radio" name="lighting-device" class="midi-lighting-rb" data-device-id="" ${!this.app.selectedMIDILighting ? 'checked' : ''}>
                    <span>None (disable lighting)</span>
                </label>
            `;
            
            const noneRadio = noneItem.querySelector('.midi-lighting-rb');
            noneRadio.addEventListener('change', () => {
                if (noneRadio.checked) {
                    this.app.setMIDILighting(null, false);
                }
            });
            
            lightingList.appendChild(noneItem);
        }
    }
    
    updateMIDIDevicesUI() {
        const outputsList = document.getElementById('midi-outputs-list');
        const inputsList = document.getElementById('midi-inputs-list');
        
        if (!this.app.webMIDI) {
            outputsList.innerHTML = '<p style="color: #ff6464;">Web MIDI not available. Try Chrome or Edge browser.</p>';
            inputsList.innerHTML = '';
            return;
        }
        
        outputsList.innerHTML = '<h3 style="margin-bottom: 10px;">MIDI Outputs (Playback)</h3>';
        
        if (this.app.midiOutputDevices.size === 0) {
            outputsList.innerHTML += '<p style="color: #a0a8b8; font-size: 14px;">No MIDI output devices found</p>';
        } else {
            this.app.midiOutputDevices.forEach((device, id) => {
                const isSelected = this.app.selectedMIDIOutputs.has(id);
                
                const deviceItem = document.createElement('div');
                deviceItem.className = 'midi-device-item';
                deviceItem.innerHTML = `
                    <label>
                        <input type="checkbox" class="midi-output-cb" data-device-id="${id}" ${isSelected ? 'checked' : ''}>
                        <span>${device.name}</span>
                        ${device.manufacturer ? `<span style="color: #a0a8b8; font-size: 12px;"> (${device.manufacturer})</span>` : ''}
                    </label>
                `;
                
                const checkbox = deviceItem.querySelector('.midi-output-cb');
                checkbox.addEventListener('change', () => {
                    this.app.setMIDIOutput(id, checkbox.checked);
                });
                
                outputsList.appendChild(deviceItem);
            });
        }
        
        inputsList.innerHTML = '<h3 style="margin: 20px 0 10px 0;">MIDI Inputs (Keyboard)</h3>';
        
        if (this.app.midiInputDevices.size === 0) {
            inputsList.innerHTML += '<p style="color: #a0a8b8; font-size: 14px;">No MIDI input devices found</p>';
        } else {
            this.app.midiInputDevices.forEach((device, id) => {
                const isSelected = this.app.selectedMIDIInputs.has(id);
                
                const deviceItem = document.createElement('div');
                deviceItem.className = 'midi-device-item';
                deviceItem.innerHTML = `
                    <label>
                        <input type="checkbox" class="midi-input-cb" data-device-id="${id}" ${isSelected ? 'checked' : ''}>
                        <span>${device.name}</span>
                        ${device.manufacturer ? `<span style="color: #a0a8b8; font-size: 12px;"> (${device.manufacturer})</span>` : ''}
                    </label>
                `;
                
                const checkbox = deviceItem.querySelector('.midi-input-cb');
                checkbox.addEventListener('change', () => {
                    this.app.setMIDIInput(id, checkbox.checked);
                });
                
                inputsList.appendChild(deviceItem);
            });
        }
    }
    
    updateLearningIndicator() {
        const indicator = document.getElementById('learning-indicator');
        const learningChannels = [];
        
        this.app.channelSettings.forEach((settings, channel) => {
            if (settings.learning) {
                learningChannels.push(channel);
            }
        });
        
        if (learningChannels.length > 0) {
            indicator.textContent = `Learning: Ch ${learningChannels.join(', ')}`;
            indicator.style.display = 'inline';
        } else {
            indicator.textContent = '';
            indicator.style.display = 'none';
        }
    }
    
    setupProgressBar() {
        const progressBar = document.getElementById('progress-bar');
        let dragging = false;
        
        const seek = (e) => {
            const rect = progressBar.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, x / rect.width));
            this.app.seek(progress * this.app.totalTime);
        };
        
        progressBar.addEventListener('mousedown', (e) => {
            dragging = true;
            seek(e);
        });
        
        document.addEventListener('mousemove', (e) => {
            if (dragging) {
                seek(e);
            }
        });
        
        document.addEventListener('mouseup', () => {
            dragging = false;
        });
        
        progressBar.addEventListener('click', seek);
    }

    setupLightingModal() {
        const modal = document.getElementById('lighting-modal');
        
        // Enabled checkbox
        const enabledCb = document.getElementById('lighting-enabled');
        enabledCb.addEventListener('change', () => {
            this.app.lightingEnabled = enabledCb.checked;
            if (!enabledCb.checked) {
                this.app.clearAllLighting();
            }
        });
        
        // All channels checkbox
        const allChannelsCb = document.getElementById('lighting-all-channels');
        allChannelsCb.addEventListener('change', () => {
            this.app.lightingUseAllChannels = allChannelsCb.checked;
            const singleChannelSettings = document.getElementById('single-channel-settings');
            singleChannelSettings.style.display = allChannelsCb.checked ? 'none' : 'block';
        });
        
        // Channel input
        const channelInput = document.getElementById('lighting-channel');
        channelInput.addEventListener('change', () => {
            this.app.lightingChannel = Math.max(0, Math.min(15, parseInt(channelInput.value) || 0));
        });
        
        // Program input
        const programInput = document.getElementById('lighting-program');
        programInput.addEventListener('change', () => {
            this.app.lightingProgram = Math.max(0, Math.min(127, parseInt(programInput.value) || 0));
        });
        
        // Apply button
        const applyBtn = document.getElementById('btn-apply-lighting');
        applyBtn.addEventListener('click', () => {
            this.app.setupLightingPrograms();
            modal.classList.remove('active');
        });
    }

    setupShareModal() {
        const modal = document.getElementById('share-modal');
        const linkInput = document.getElementById('share-link-input');
        const copyBtn = document.getElementById('btn-copy-link');
        const autoplayCb = document.getElementById('share-autoplay');
        
        copyBtn.addEventListener('click', () => {
            linkInput.select();
            navigator.clipboard.writeText(linkInput.value).then(() => {
                copyBtn.textContent = '✓ Copied!';
                setTimeout(() => {
                    copyBtn.innerHTML = '📋 Copy';
                }, 2000);
            });
        });
        
        autoplayCb.addEventListener('change', () => {
            this.updateShareLink();
        });
    }

    showShareModal() {
        if (!this.app.currentMIDIPath) {
            alert('Please load a MIDI file first');
            return;
        }
        
        const modal = document.getElementById('share-modal');
        this.updateShareLink();
        modal.classList.add('active');
    }

    updateShareLink() {
        const autoplay = document.getElementById('share-autoplay').checked;
        const link = this.app.getShareLink(autoplay);
        
        if (link) {
            document.getElementById('share-link-input').value = link;
            this.generateQRCode(link);
        }
    }

    generateQRCode(text) {
        const container = document.getElementById('qr-code-container');
        container.innerHTML = ''; // Очищаем
        try {
            if (typeof QRCode !== 'undefined') {
                new QRCode(container, {
                    text: text,
                    width: 300,
                    height: 300,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            } else {
                // Fallback если библиотека не загрузилась
                const canvas = document.createElement('canvas');
                canvas.id = 'qr-code-canvas';
                canvas.width = 300;
                canvas.height = 300;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, 200, 200);
                ctx.fillStyle = '#000';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('QR Code library', 100, 90);
                ctx.fillText('not loaded', 100, 110);
                container.appendChild(canvas);
            }
        } catch (error) {
            console.error('QR code generation error:', error);
        }
    }


    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        this.updateMIDIDevicesUI();
        
        // НОВОЕ: Обновляем кнопки управления настройками
        this.updateSettingsButtons();
        
        modal.classList.add('active');
    }

    updateSettingsButtons() {
        const savedSettings = this.app.settingsManager.loadSettings();
        const hasSettings = savedSettings !== null;
        
        const lastSaved = document.getElementById('settings-last-saved');
        if (lastSaved && hasSettings) {
            const date = new Date(savedSettings.timestamp);
            lastSaved.textContent = `Last saved: ${date.toLocaleString()}`;
        } else if (lastSaved) {
            lastSaved.textContent = 'No saved settings';
        }
    }

    setupSettingsButtons() {
        const saveBtn = document.getElementById('btn-save-settings');
        const clearBtn = document.getElementById('btn-clear-settings');
        const exportBtn = document.getElementById('btn-export-settings');
        const importBtn = document.getElementById('btn-import-settings');
        const fileInput = document.getElementById('settings-file-input');
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.app.saveCurrentSettings();
                this.updateSettingsButtons();
            });
        }
        
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all saved settings?')) {
                    this.app.settingsManager.clearSettings();
                    this.updateSettingsButtons();
                    
                    const statusText = document.getElementById('status-text');
                    const oldText = statusText.textContent;
                    statusText.textContent = '✓ Settings cleared!';
                    statusText.style.color = '#ffc864';
                    
                    setTimeout(() => {
                        statusText.textContent = oldText;
                        statusText.style.color = '';
                    }, 2000);
                }
            });
        }
        
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                const url = this.app.settingsManager.exportSettings();
                if (url) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `synthesia-settings-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    
                    const statusText = document.getElementById('status-text');
                    const oldText = statusText.textContent;
                    statusText.textContent = '✓ Settings exported!';
                    statusText.style.color = '#64c896';
                    
                    setTimeout(() => {
                        statusText.textContent = oldText;
                        statusText.style.color = '';
                    }, 2000);
                } else {
                    alert('No settings to export');
                }
            });
        }
        
        if (importBtn && fileInput) {
            importBtn.addEventListener('click', () => {
                fileInput.click();
            });
            
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const success = this.app.settingsManager.importSettings(event.target.result);
                        if (success) {
                            alert('Settings imported successfully! Please reload the page to apply them.');
                            this.updateSettingsButtons();
                        } else {
                            alert('Failed to import settings. Invalid file format.');
                        }
                    };
                    reader.readAsText(file);
                }
                fileInput.value = ''; // Reset
            });
        }
    }

    setupAudioEngineControls() {
        const enableCb = document.getElementById('audio-engine-enable');
        const volumeSlider = document.getElementById('audio-volume');
        const volumeValue = document.getElementById('audio-volume-value');
        const loadSamplesBtn = document.getElementById('btn-load-audio-samples');
        const audioSettings = document.getElementById('audio-engine-settings');
        const pianoOnlyCb = document.getElementById('audio-piano-only'); 
        const showDetailsBtn = document.getElementById('btn-show-audio-details');
        
        if (enableCb) {
            enableCb.addEventListener('change', async () => {
                const enabled = enableCb.checked;
                
                if (enabled && !this.app.audioEngine.context) {
                    await this.app.audioEngine.initialize();
                }
                
                await this.app.setAudioEngine(enabled);
                
                if (audioSettings) {
                    audioSettings.style.display = enabled ? 'block' : 'none';
                }
                
                this.updateAudioEngineStatus();
            });
        }

        if (pianoOnlyCb) {
                pianoOnlyCb.addEventListener('change', async () => {
                    const pianoOnly = pianoOnlyCb.checked;
                    this.app.audioEngineUsePianoOnly = pianoOnly;
                    this.app.audioEngine.setPianoOnly(pianoOnly);
                    
                    // Если есть загруженный MIDI и Audio Engine включен, перезагружаем сэмплы
                    if (this.app.midiData && this.app.useAudioEngine) {
                        const statusText = document.getElementById('status-text');
                        const oldText = statusText.textContent;
                        
                        statusText.textContent = pianoOnly ? 
                            '🎹 Switching to Piano Only...' : 
                            '🎵 Switching to Multi-instrument...';
                        statusText.style.color = '#ffc864';
                        
                        // Отключаем кнопку загрузки на время перезагрузки
                        if (loadSamplesBtn) {
                            loadSamplesBtn.disabled = true;
                            loadSamplesBtn.textContent = 'Loading...';
                        }
                        
                        try {
                            // Перезагружаем сэмплы с новыми настройками
                            await this.app.loadAudioSamplesForCurrentMIDI();
                            
                            statusText.textContent = pianoOnly ? 
                                '✓ Switched to Piano Only' : 
                                '✓ Switched to Multi-instrument';
                            statusText.style.color = '#64c896';
                            
                            if (loadSamplesBtn) {
                                loadSamplesBtn.textContent = '✓ Loaded';
                            }
                        } catch (error) {
                            console.error('Error reloading samples:', error);
                            statusText.textContent = '✗ Error loading samples';
                            statusText.style.color = '#ff6464';
                            
                            if (loadSamplesBtn) {
                                loadSamplesBtn.textContent = '✗ Error';
                            }
                        }
                        
                        // Восстанавливаем кнопку через 2 секунды
                        setTimeout(() => {
                            statusText.textContent = oldText;
                            statusText.style.color = '';
                            
                            if (loadSamplesBtn) {
                                loadSamplesBtn.textContent = '📥 Load Audio Samples';
                                loadSamplesBtn.disabled = false;
                            }
                        }, 2000);
                        
                        this.updateAudioEngineStatus();
                    } else if (this.app.midiData) {
                        // Если Audio Engine выключен, просто показываем сообщение
                        const statusText = document.getElementById('status-text');
                        const oldText = statusText.textContent;
                        
                        statusText.textContent = 'Enable Audio Engine to use this setting';
                        statusText.style.color = '#ffc864';
                        
                        setTimeout(() => {
                            statusText.textContent = oldText;
                            statusText.style.color = '';
                        }, 2000);
                    }
                });
        }
        
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', () => {
                const volume = parseInt(volumeSlider.value) / 100;
                this.app.audioEngine.setVolume(volume);
                volumeValue.textContent = `${volumeSlider.value}%`;
            });
        }
        
        if (loadSamplesBtn) {
            loadSamplesBtn.addEventListener('click', async () => {
                loadSamplesBtn.disabled = true;
                loadSamplesBtn.textContent = 'Loading...';
                
                try {
                    await this.app.loadAudioSamplesForCurrentMIDI();
                    loadSamplesBtn.textContent = '✓ Loaded';
                    
                    setTimeout(() => {
                        loadSamplesBtn.textContent = '📥 Load Audio Samples';
                        loadSamplesBtn.disabled = false;
                    }, 2000);
                } catch (error) {
                    console.error('Error loading samples:', error);
                    loadSamplesBtn.textContent = '✗ Error';
                    loadSamplesBtn.disabled = false;
                }
                
                this.updateAudioEngineStatus();
            });
        }
        
        if (showDetailsBtn) {
            showDetailsBtn.addEventListener('click', () => {
                this.showAudioDetailsModal();
            });
        }

        // Обновляем статус каждую секунду когда модал открыт
        setInterval(() => {
            if (document.getElementById('settings-modal').classList.contains('active')) {
                this.updateAudioEngineStatus();
            }
        }, 1000);
    }

    updateAudioEngineStatus() {
        const status = this.app.audioEngine.getStatus();
        
        const statusText = document.getElementById('audio-status-text');
        const samplesLoaded = document.getElementById('audio-samples-loaded');
        const activeSounds = document.getElementById('audio-active-sounds');
        const memoryUsage = document.getElementById('audio-memory-usage');
        
        if (statusText) {
            let text = 'Not initialized';
            if (status.initialized) {
                const mode = this.app.audioEngineUsePianoOnly ? ' (Piano Only)' : '';
                text = status.enabled ? `✓ Active${mode} (${status.state})` : 'Initialized but disabled';
            }
            if (status.loading) {
                text = 'Loading samples...';
            }
            statusText.textContent = text;
            statusText.style.color = status.enabled ? '#64c896' : '#a0a8b8';
        }
        
        if (samplesLoaded) {
            // Показываем количество сэмплов и каналов
            if (status.channels > 0) {
                samplesLoaded.textContent = `${status.samplesLoaded} (${status.channels} channels)`;
            } else {
                samplesLoaded.textContent = status.samplesLoaded;
            }
        }
        
        if (activeSounds) {
            activeSounds.textContent = status.activeSounds;
        }

        // Отображение размера загруженных сэмплов
        if (memoryUsage) {
            if (status.totalBytes > 0) {
                memoryUsage.textContent = status.sizeFormatted;
                
                // Меняем цвет в зависимости от размера
                if (status.totalBytes > 100 * 1024 * 1024) { // > 100 MB
                    memoryUsage.style.color = '#ff6464';
                } else if (status.totalBytes > 50 * 1024 * 1024) { // > 50 MB
                    memoryUsage.style.color = '#ffc864';
                } else {
                    memoryUsage.style.color = '#64c896';
                }
            } else {
                memoryUsage.textContent = '0 MB';
                memoryUsage.style.color = '#a0a8b8';
            }
        }        
    }

    showSettingsModal() {
        const modal = document.getElementById('settings-modal');
        
        // Обновляем состояние Audio Engine
        const enableCb = document.getElementById('audio-engine-enable');
        if (enableCb) {
            enableCb.checked = this.app.useAudioEngine;
        }
        
        const audioSettings = document.getElementById('audio-engine-settings');
        if (audioSettings) {
            audioSettings.style.display = this.app.useAudioEngine ? 'block' : 'none';
        }

        const pianoOnlyCb = document.getElementById('audio-piano-only');
        if (pianoOnlyCb) {
            pianoOnlyCb.checked = this.app.audioEngineUsePianoOnly;
        }
        
        const volumeSlider = document.getElementById('audio-volume');
        const volumeValue = document.getElementById('audio-volume-value');
        if (volumeSlider && volumeValue) {
            const volume = Math.round(this.app.audioEngine.volume * 100);
            volumeSlider.value = volume;
            volumeValue.textContent = `${volume}%`;
        }
        
        this.updateAudioEngineStatus();
        this.updateMIDIDevicesUI();
        this.updateSettingsButtons();
        
        modal.classList.add('active');
    }


    showAudioDetailsModal() {
        const sizeInfo = this.app.audioEngine.getSizeInfo();
        
        let detailsHTML = `
            <h3>Audio Samples Details</h3>
            <div style="margin: 15px 0;">
                <strong>Total Size:</strong> ${(sizeInfo.totalMB).toFixed(2)} MB (${sizeInfo.totalBytes.toLocaleString()} bytes)<br>
                <strong>Total Samples:</strong> ${sizeInfo.sampleCount}<br>
                <strong>Average Sample Size:</strong> ${(sizeInfo.averageSampleSize / 1024).toFixed(1)} KB<br>
            </div>
            <h4>Size by Channel:</h4>
            <div style="max-height: 300px; overflow-y: auto;">
        `;
        
        const sortedChannels = Array.from(sizeInfo.channelSizes.entries())
            .sort((a, b) => b[1] - a[1]); // Сортируем по размеру (больше -> меньше)
        
        sortedChannels.forEach(([channel, bytes]) => {
            const mb = (bytes / (1024 * 1024)).toFixed(2);
            const channelSettings = this.app.channelSettings.get(channel);
            const folder = this.app.audioEngine.channelFolders.get(channel) || 'unknown';
            const samplesCount = Array.from(this.app.audioEngine.sampleSizes.keys())
                .filter(key => key.startsWith(`${channel}_`)).length;
            
            detailsHTML += `
                <div style="padding: 8px; margin: 5px 0; background: rgba(255,255,255,0.05); border-radius: 4px;">
                    <strong>Channel ${channel}</strong> (${folder}): ${mb} MB
                    <span style="color: #a0a8b8; font-size: 12px;">(${samplesCount} samples)</span>
                </div>
            `;
        });
        
        detailsHTML += '</div>';
        
        // Создаем или обновляем модальное окно
        let modal = document.getElementById('audio-details-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'audio-details-modal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 600px;">
                    <span class="close-btn">&times;</span>
                    <div id="audio-details-content"></div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelector('.close-btn').addEventListener('click', () => {
                modal.classList.remove('active');
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        }
        
        document.getElementById('audio-details-content').innerHTML = detailsHTML;
        modal.classList.add('active');
    }
}
