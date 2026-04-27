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

def parse_midi_file(filepath: str) -> Dict[str, Any]:
    """Parse MIDI file and return notes data"""
    try:
        midi_file = MidiFile(filepath)
        
        notes = []
        tempo = 500000
        ticks_per_beat = midi_file.ticks_per_beat
        
        channels_used = set()
        channel_programs = {}  # Сохраняем программы каналов
        
        for track_idx, track in enumerate(midi_file.tracks):
            current_time = 0.0
            active_notes = {}
            
            for msg in track:
                current_time += mido.tick2second(msg.time, ticks_per_beat, tempo)
                
                if msg.type == 'set_tempo':
                    tempo = msg.tempo
                
                # ИСПРАВЛЕНИЕ: Сохраняем программы каналов
                elif msg.type == 'program_change':
                    channel_programs[msg.channel] = msg.program
                    print(f"Track {track_idx}: Channel {msg.channel} -> Program {msg.program}")
                
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
        
        total_time = max(n['end_time'] for n in notes) if notes else 0
        
        # Устанавливаем программу 0 для каналов без явно указанной программы
        for channel in channels_used:
            if channel not in channel_programs:
                channel_programs[channel] = 0
        
        print(f"Channel programs: {channel_programs}")
        
        return {
            'success': True,
            'notes': notes,
            'total_time': total_time,
            'channels': sorted(list(channels_used)),
            'channel_programs': channel_programs,  # ИСПРАВЛЕНИЕ: Добавляем программы
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
