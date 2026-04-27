// Utility functions for MIDI parsing (if needed client-side)

class MIDIParser {
    static parseFile(arrayBuffer) {
        // This would contain MIDI file parsing logic
        // For this implementation, we're using the backend for parsing
        // But keeping this file for future enhancements
    }
    
    static formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    static getNoteName(pitch) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(pitch / 12) - 1;
        const note = noteNames[pitch % 12];
        return `${note}${octave}`;
    }
}