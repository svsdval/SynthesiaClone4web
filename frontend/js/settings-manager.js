class SettingsManager {
    constructor() {
        this.storageKey = 'synthesia-settings';
    }
    
    saveSettings(app) {
        const settings = {
            version: '1.0',
            timestamp: Date.now(),
            
            // MIDI устройства
            midiDevices: {
                inputs: Array.from(app.selectedMIDIInputs).map(id => ({
                    id: id,
                    name: app.midiInputDevices.get(id)?.name
                })),
                outputs: Array.from(app.selectedMIDIOutputs).map(id => ({
                    id: id,
                    name: app.midiOutputDevices.get(id)?.name
                })),
                lighting: app.selectedMIDILighting ? {
                    id: app.selectedMIDILighting,
                    name: app.midiLightingDevice?.name
                } : null
            },
            
            // Настройки подсветки
            lighting: {
                enabled: app.lightingEnabled,
                useAllChannels: app.lightingUseAllChannels,
                channel: app.lightingChannel,
                program: app.lightingProgram
            },
            
            // НОВОЕ: Настройки Audio Engine
            audioEngine: {
                enabled: app.useAudioEngine,
                volume: app.audioEngine.volume,
                sePianoOnly: app.audioEngineUsePianoOnly
            },
            
            // Цвета каналов
            channelColors: this.serializeChannelColors(app.channelSettings),
            
            // Другие настройки
            scrollSpeed: app.scrollSpeed,
            earlyPressTolerance: app.earlyPressTolerance
        };
        
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(settings));
            console.log('✓ Settings saved:', settings);
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }

    
    loadSettings() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (!data) {
                console.log('No saved settings found');
                return null;
            }
            
            const settings = JSON.parse(data);
            console.log('✓ Settings loaded:', settings);
            return settings;
        } catch (error) {
            console.error('Failed to load settings:', error);
            return null;
        }
    }
    
    serializeChannelColors(channelSettings) {
        const colors = {};
        channelSettings.forEach((settings, channel) => {
            colors[channel] = settings.color;
        });
        return colors;
    }
    
    applySettings(app, settings) {
        if (!settings) return false;
        
        console.log('Applying saved settings...');
        
        try {
            // Применяем настройки подсветки
            if (settings.lighting) {
                app.lightingEnabled = settings.lighting.enabled || false;
                app.lightingUseAllChannels = settings.lighting.useAllChannels !== undefined 
                    ? settings.lighting.useAllChannels : true;
                app.lightingChannel = settings.lighting.channel || 0;
                app.lightingProgram = settings.lighting.program || 0;
            }
            
            if (settings.audioEngine) {
                if (settings.audioEngine.usePianoOnly !== undefined) {
                    app.audioEngineUsePianoOnly = settings.audioEngine.usePianoOnly;
                    app.audioEngine.setPianoOnly(settings.audioEngine.usePianoOnly);
                }
            }            
            // Применяем другие настройки
            if (settings.scrollSpeed) {
                app.scrollSpeed = settings.scrollSpeed;
                document.getElementById('speed-slider').value = settings.scrollSpeed;
                document.getElementById('speed-value').textContent = `${settings.scrollSpeed} px/s`;
                if (app.renderer) {
                    app.renderer.setScrollSpeed(settings.scrollSpeed);
                }
            }
            
            if (settings.earlyPressTolerance !== undefined) {
                app.earlyPressTolerance = settings.earlyPressTolerance;
            }
            
            // Сохраняем цвета для последующего применения
            if (settings.channelColors) {
                app.savedChannelColors = settings.channelColors;
            }
            
            console.log('✓ Settings applied (devices will be restored after MIDI init)');
            return true;
        } catch (error) {
            console.error('Failed to apply settings:', error);
            return false;
        }
    }
    
    restoreMIDIDevices(app, settings) {
        if (!settings || !settings.midiDevices || !app.webMIDI) {
            console.log('Cannot restore MIDI devices: no settings or MIDI not initialized');
            return;
        }
        
        console.log('Restoring MIDI devices...');
        
        let restoredCount = 0;
        
        // Восстанавливаем входы
        if (settings.midiDevices.inputs) {
            settings.midiDevices.inputs.forEach(savedDevice => {
                // Ищем устройство по имени (ID может измениться)
                let foundDevice = null;
                
                for (const [id, device] of app.midiInputDevices.entries()) {
                    if (device.name === savedDevice.name) {
                        foundDevice = { id, device };
                        break;
                    }
                }
                
                if (foundDevice) {
                    app.setMIDIInput(foundDevice.id, true);
                    restoredCount++;
                    console.log(`✓ Restored MIDI input: ${savedDevice.name}`);
                } else {
                    console.warn(`✗ MIDI input not found: ${savedDevice.name}`);
                }
            });
        }
        
        // Восстанавливаем выходы
        if (settings.midiDevices.outputs) {
            settings.midiDevices.outputs.forEach(savedDevice => {
                let foundDevice = null;
                
                for (const [id, device] of app.midiOutputDevices.entries()) {
                    if (device.name === savedDevice.name) {
                        foundDevice = { id, device };
                        break;
                    }
                }
                
                if (foundDevice) {
                    app.setMIDIOutput(foundDevice.id, true);
                    restoredCount++;
                    console.log(`✓ Restored MIDI output: ${savedDevice.name}`);
                } else {
                    console.warn(`✗ MIDI output not found: ${savedDevice.name}`);
                }
            });
        }
        
        // Восстанавливаем подсветку
        if (settings.midiDevices.lighting) {
            let foundDevice = null;
            
            for (const [id, device] of app.midiOutputDevices.entries()) {
                if (device.name === settings.midiDevices.lighting.name) {
                    foundDevice = { id, device };
                    break;
                }
            }
            
            if (foundDevice) {
                app.setMIDILighting(foundDevice.id, true);
                restoredCount++;
                console.log(`✓ Restored MIDI lighting: ${settings.midiDevices.lighting.name}`);
            } else if (settings.midiDevices.lighting.name) {
                console.warn(`✗ MIDI lighting not found: ${settings.midiDevices.lighting.name}`);
            }
        }
        
        console.log(`✓ Restored ${restoredCount} MIDI device(s)`);
        
        // Обновляем UI если модал открыт
        if (app.controls) {
            app.controls.updateMIDIDevicesUI();
        }
    }
    
    applyChannelColors(app) {
        if (!app.savedChannelColors || !app.channelSettings) {
            return;
        }
        
        console.log('Applying saved channel colors...');
        
        let appliedCount = 0;
        app.channelSettings.forEach((settings, channel) => {
            if (app.savedChannelColors[channel]) {
                settings.color = app.savedChannelColors[channel];
                appliedCount++;
            }
        });
        
        console.log(`✓ Applied ${appliedCount} channel color(s)`);
    }
    
    clearSettings() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('✓ Settings cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear settings:', error);
            return false;
        }
    }
    
    exportSettings() {
        const settings = this.loadSettings();
        if (!settings) {
            return null;
        }
        
        const dataStr = JSON.stringify(settings, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        return URL.createObjectURL(dataBlob);
    }
    
    importSettings(jsonData) {
        try {
            const settings = JSON.parse(jsonData);
            localStorage.setItem(this.storageKey, JSON.stringify(settings));
            console.log('✓ Settings imported');
            return true;
        } catch (error) {
            console.error('Failed to import settings:', error);
            return false;
        }
    }
}