from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import mido
from mido import MidiFile
import rtmidi
import os
import json
from pathlib import Path
from typing import List, Dict, Any
import asyncio
from collections import defaultdict

app = FastAPI(title="MIDI Parser API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MIDI_FOLDER = './midi'
UPLOAD_FOLDER = './uploads'
AUDIO_FOLDER = './audio/piano'

# Создаем директории
os.makedirs(MIDI_FOLDER, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(AUDIO_FOLDER, exist_ok=True)

def add_note_gaps(notes, note_gap=0.02):
    """Добавить зазоры между последовательными нотами одного pitch"""
    notes_by_pitch = defaultdict(list)
                
    for note in notes:
        notes_by_pitch[note['pitch']].append(note)
        
    for pitch, pitch_notes in notes_by_pitch.items():
        pitch_notes.sort(key=lambda n: n['start_time'])

        for i in range(len(pitch_notes) - 1):
            current_note = pitch_notes[i]
            next_note = pitch_notes[i + 1]
            
            if abs(next_note['start_time'] - current_note['end_time']) < 0.001:
                current_note['end_time'] -= note_gap
#                current_note['end_time'] -= note_gap / 2
#                next_note['start_time'] += note_gap / 2

                if current_note['end_time'] <= current_note['start_time']:
                    current_note['end_time'] = current_note['start_time'] + 0.01


def parse_midi_file(filepath):
    """Parse MIDI file and return notes data with proper bank detection"""
    parse_debug = False
    try:
        midi_file = MidiFile(filepath)
        
        notes = []
        tempo = 500000
        ticks_per_beat = midi_file.ticks_per_beat
        
        channels_used = set()
        channel_programs = {}
        channel_banks = {}
        drum_channels = set()  # Отслеживаем барабанные каналы
        
        # Первый проход - собираем информацию о барабанных каналах
        for track_idx, track in enumerate(midi_file.tracks):
            for msg in track:
                # Проверяем явные установки барабанного банка
                if msg.type == 'control_change' and msg.control == 0:
                    if msg.value == 120 or msg.value == 127 or msg.value == 128:
                        drum_channels.add(msg.channel)
                        if parse_debug:
                            print(f"Drum channel detected: {msg.channel} (Bank MSB={msg.value})")
        
        # Второй проход - основной парсинг
        for track_idx, track in enumerate(midi_file.tracks):
            current_time = 0.0
            active_notes = {}
            
            for msg in track:
                current_time += mido.tick2second(msg.time, ticks_per_beat, tempo)
                
                if msg.type == 'set_tempo':
                    tempo = msg.tempo
                
                elif msg.type == 'control_change':
                    # Bank Select MSB (CC 0)
                    if msg.control == 0:
                        if msg.channel not in channel_banks:
                            channel_banks[msg.channel] = {'msb': 0, 'lsb': 0}
                        channel_banks[msg.channel]['msb'] = msg.value
                        
                        # Проверяем барабанные банки
                        if msg.value in [120, 127, 128]:
                            drum_channels.add(msg.channel)
                        if parse_debug:                        
                            print(f"Track {track_idx}: Channel {msg.channel} -> Bank MSB {msg.value}")
                    
                    # Bank Select LSB (CC 32)
                    elif msg.control == 32:
                        if msg.channel not in channel_banks:
                            channel_banks[msg.channel] = {'msb': 0, 'lsb': 0}
                        channel_banks[msg.channel]['lsb'] = msg.value
                        if parse_debug:
                            print(f"Track {track_idx}: Channel {msg.channel} -> Bank LSB {msg.value}")
                
                elif msg.type == 'program_change':
                    channel_programs[msg.channel] = msg.program
                    
                    bank_info = channel_banks.get(msg.channel, {'msb': 0, 'lsb': 0})
                    bank_number = (bank_info['msb'] << 7) | bank_info['lsb']
                    
                    if parse_debug:
                       print(f"Track {track_idx}: Channel {msg.channel} -> "
                          f"Program {msg.program}, Bank {bank_info['msb']}:{bank_info['lsb']} "
                          f"(Combined: {bank_number})")
                
                elif msg.type == 'note_on' and msg.velocity > 0:
                    key = (msg.note, msg.channel)
                    active_notes[key] = {
                        'start_time': current_time,
                        'velocity': msg.velocity
                    }
                    channels_used.add(msg.channel)
                
                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    key = (msg.note, msg.channel)
                    if key in active_notes:
                        note_data = active_notes[key]
                        notes.append({
                            'pitch': msg.note,
                            'start_time': note_data['start_time'],
                            'end_time': current_time,
                            'velocity': note_data['velocity'],
                            'channel': msg.channel
                        })
                        del active_notes[key]
        
        notes.sort(key=lambda n: n['start_time'])
        add_note_gaps(notes)

        total_time = max(n['end_time'] for n in notes) if notes else 0
        
        # Устанавливаем значения банков
        for channel in channels_used:
            if channel not in channel_programs:
                channel_programs[channel] = 0
            
            if channel not in channel_banks:
                # Канал 9 или явно помеченный барабанный канал
                if channel == 9 or channel in drum_channels:
                    channel_banks[channel] = {'msb': 128, 'lsb': 0}
                    drum_channels.add(channel)
                else:
                    channel_banks[channel] = {'msb': 0, 'lsb': 0}
            else:
                # Проверяем, не является ли установленный банк барабанным
                if channel_banks[channel]['msb'] in [120, 127, 128]:
                    drum_channels.add(channel)
        
        # Если канал 9 используется, но банк не установлен явно - устанавливаем 128
        if 9 in channels_used and channel_banks.get(9, {}).get('msb', 0) == 0:
            channel_banks[9] = {'msb': 128, 'lsb': 0}
            drum_channels.add(9)
        
        if parse_debug:
           print(f"\n=== MIDI File Summary ===")
           print(f"Channel programs: {channel_programs}")
           print(f"Channel banks: {channel_banks}")
           print(f"Drum channels: {sorted(drum_channels)}")
        
           print(f"\n=== Detailed Channel Info ===")
           for channel in sorted(channels_used):
               bank = channel_banks[channel]
               program = channel_programs[channel]
               bank_combined = (bank['msb'] << 7) | bank['lsb']
               is_drum = channel in drum_channels
               channel_type = "🥁 DRUMS" if is_drum else "🎵 Melodic"
               
               print(f"Channel {channel:2d}: Bank {bank['msb']:3d}:{bank['lsb']:3d} "
                     f"(Combined: {bank_combined:5d}), Program {program:3d} - {channel_type}")
        
        return {
            'success': True,
            'notes': notes,
            'total_time': total_time,
            'channels': sorted(list(channels_used)),
            'channel_programs': channel_programs,
            'channel_banks': channel_banks,
            'drum_channels': sorted(list(drum_channels)),
            'ticks_per_beat': ticks_per_beat
        }
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


@app.get("/api/files", response_model=Dict[str, List[Dict[str, Any]]])
async def list_files():
    """List all MIDI files in the midi folder"""
    files = []
    
    if not os.path.exists(MIDI_FOLDER):
        return {"files": []}
    
    for root, dirs, filenames in os.walk(MIDI_FOLDER):
        for file in filenames:
            if file.lower().endswith(('.mid', '.midi')):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, MIDI_FOLDER)
                files.append({
                    'name': file,
                    'path': rel_path,
                    'size': os.path.getsize(full_path)
                })
    
    files.sort(key=lambda x: x['name'].lower())
    return {"files": files}

@app.get("/api/parse/{filename}", response_model=Dict[str, Any])
async def parse_file(filename: str):
    """Parse a MIDI file and return its data"""
    filepath = os.path.join(MIDI_FOLDER, filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    
    result = parse_midi_file(filepath)
    return result

@app.post("/api/upload", response_model=Dict[str, Any])
async def upload_file(file: UploadFile = File(...)):
    """Upload a MIDI file"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    if not file.filename.lower().endswith(('.mid', '.midi')):
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    filename = file.filename
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    
    # Сохраняем файл
    with open(filepath, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    result = parse_midi_file(filepath)
    
    if result['success']:
        result['filename'] = filename
    
    return result

@app.get("/api/audio/piano/{note:int}.mp3", response_model=Dict[str, Any])
async def get_piano_sample(note: int):
    """Get piano audio sample for a specific note"""
    if note < 21 or note > 108:
        raise HTTPException(status_code=400, detail="Invalid note number")
    
    filepath = os.path.join(AUDIO_FOLDER, f'{note}.mp3')
    
    if os.path.exists(filepath):
        return FileResponse(filepath, media_type='audio/mpeg')
    else:
        # Возвращаем пустой звук если файл не найден
        raise HTTPException(status_code=404, detail="Sample not found")

@app.get("/api/audio/check", response_model=Dict[str, Any])
async def check_audio_samples():
    """Check which audio samples are available"""
    available = []
    
    if os.path.exists(AUDIO_FOLDER):
        for note in range(21, 109):  # A0 to C8
            filepath = os.path.join(AUDIO_FOLDER, f'{note}.mp3')
            if os.path.exists(filepath):
                available.append(note)
    
    return {
        'success': True,
        'available': available,
        'total': len(available),
        'min_note': min(available) if available else None,
        'max_note': max(available) if available else None
    }

@app.get("/api/devices", response_model=Dict[str, Any])
async def get_devices():
    """Get available MIDI devices"""
    try:
        midi_out = rtmidi.MidiOut()
        output_ports = midi_out.get_ports()
        
        midi_in = rtmidi.MidiIn()
        input_ports = midi_in.get_ports()
        
        return {
            'success': True,
            'outputs': output_ports,
            'inputs': input_ports
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'outputs': [],
            'inputs': []
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)
