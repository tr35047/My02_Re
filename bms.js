
export class BMSParser {
    constructor(text) {
        this.text = text;
        this.headers = {};
        this.measures = new Map(); // measureIndex -> { channel -> stringData }
        this.notes = []; // { time, lane, type, duration }
        this.bgmEvents = []; // { time, id }
        this.bpms = []; // { time, bpm }
        this.stops = []; // { time, duration }
        this.duration = 0;
        this.minBPM = 0;
        this.maxBPM = 0;
    }

    parse() {
        const lines = this.text.split(/\r?\n/);
        const wavDefs = new Map();
        const bmpDefs = new Map();
        const bpmDefs = new Map(); // #BPMxx -> value
        const stopDefs = new Map(); // #STOPxx -> value
        
        // 1. Parse Headers and Raw Measure Data
        const reHeader = /^#([A-Z0-9]+)(?:\s+(.*))?$/i;
        const reMeasure = /^#(\d{3})(\d{2}):([0-9A-Za-z]+)$/;

        for (let line of lines) {
            line = line.trim();
            if (!line.startsWith('#')) continue;

            const matchMeasure = line.match(reMeasure);
            if (matchMeasure) {
                const mIdx = parseInt(matchMeasure[1], 10);
                const ch = matchMeasure[2];
                const data = matchMeasure[3];
                if (!this.measures.has(mIdx)) this.measures.set(mIdx, {});
                this.measures.get(mIdx)[ch] = data;
                continue;
            }

            const matchHeader = line.match(reHeader);
            if (matchHeader) {
                const key = matchHeader[1].toUpperCase();
                const value = matchHeader[2];
                this.headers[key] = value;

                if (key.startsWith('WAV')) wavDefs.set(key.substr(3), value);
                if (key.startsWith('BMP')) bmpDefs.set(key.substr(3), value);
                if (key.startsWith('BPM') && key.length === 5) bpmDefs.set(key.substr(3), parseFloat(value));
                if (key.startsWith('STOP')) stopDefs.set(key.substr(4), parseInt(value, 10));
            }
        }

        // 2. Build Time Line
        const initialBPM = parseFloat(this.headers['BPM'] || 120);
        let currentBPM = initialBPM;
        let currentTime = 0;
        
        // Collect all time-affecting events first to calculate timing
        // Events: { beat, type, value, measureIndex, numerator, denominator }
        // beat is absolute beat number from start.
        
        // We need to know the length of each measure. 
        // Default is 4 beats (4/4 time). #xxx02 defines measure length scale.
        
        const sortedMeasureKeys = Array.from(this.measures.keys()).sort((a, b) => a - b);
        const maxMeasure = sortedMeasureKeys.length > 0 ? sortedMeasureKeys[sortedMeasureKeys.length - 1] : 0;
        
        // Calculate measure start beats
        const measureStartBeats = new Array(maxMeasure + 2).fill(0);
        let currentTotalBeats = 0;
        
        for (let i = 0; i <= maxMeasure; i++) {
            measureStartBeats[i] = currentTotalBeats;
            let scale = 1.0;
            if (this.measures.has(i) && this.measures.get(i)['02']) {
                scale = parseFloat(this.measures.get(i)['02']);
            }
            currentTotalBeats += 4.0 * scale; // Standard 4/4
        }
        measureStartBeats[maxMeasure + 1] = currentTotalBeats;

        // Helper to get absolute beat for a position in a measure
        const getBeat = (mIdx, step, totalSteps) => {
            const mStart = measureStartBeats[mIdx];
            const mLen = measureStartBeats[mIdx + 1] - mStart;
            return mStart + (step / totalSteps) * mLen;
        };

        // Collect all events
        const timeEvents = []; // { beat, type, value }
        const channelEvents = []; // { beat, type, lane, valStr } for notes

        for (const mIdx of sortedMeasureKeys) {
            const channels = this.measures.get(mIdx);
            for (const ch in channels) {
                const data = channels[ch];
                const len = data.length;
                const steps = len / 2;
                
                for (let i = 0; i < steps; i++) {
                    const valStr = data.substr(i * 2, 2);
                    const beat = getBeat(mIdx, i, steps);
                    
                    const isLNChannel = ['51', '52', '53', '54'].includes(ch);
                    const lnType = parseInt(this.headers['LNTYPE'] || '1', 10);

                    // Skip 00 unless it's an LN channel and we are in LNTYPE 2
                    if (valStr === '00') {
                        if (isLNChannel && lnType === 2) {
                             const lane = parseInt(ch) - 51;
                             channelEvents.push({ beat, type: 'ln', lane, valStr });
                        }
                        continue;
                    }
                    
                    // BPM Change (Standard)
                    if (ch === '03') {
                        const newBPM = parseInt(valStr, 16);
                        timeEvents.push({ beat, type: 'bpm', value: newBPM });
                    }
                    // BPM Change (Extended)
                    else if (ch === '08') {
                        if (bpmDefs.has(valStr)) {
                            timeEvents.push({ beat, type: 'bpm', value: bpmDefs.get(valStr) });
                        }
                    }
                    // Stop
                    else if (ch === '09') {
                        if (stopDefs.has(valStr)) {
                            timeEvents.push({ beat, type: 'stop', value: stopDefs.get(valStr) });
                        }
                    }
                    // BGM (Background Music)
                    else if (ch === '01') {
                         channelEvents.push({ beat, type: 'bgm', valStr });
                    }
                    // P1 Visible Notes (11-15/16/18/19 for 5K/7K/9K but we only support 4K usually? 
                    // BMS Standard: 11-15 (1P 1-5), 16 (Scratch), 18-19 (6-7)
                    // MyO2 usually 4K: 11,12,13,14? Or 11,12,13,14,15?
                    // Let's support 11-19 to be safe and map them modulo 4 or just filter
                    // Standard 7K is 11,12,13,14,15,18,19.
                    // User asked for 4K. If the BMS is 4K, it uses 11,12,13,14? 
                    // Or maybe 11,12,13,15? (1,2,3,5 keys in IIDX layout?)
                    // Let's look at common 4K BMS. Usually 11,12,13,14.
                    // But wait, user says "rightmost track not reading".
                    // Maybe the BMS uses 15 instead of 14? Or 18/19?
                    // Let's expand the range and log warning if out of bounds?
                    // Or just map standard IIDX keys to 4 lanes?
                    // 1P Lanes: 11, 12, 13, 14, 15, 18, 19
                    // If 4K, it might use 11, 12, 13, 14.
                    // Let's just support 11-19 and clamp/ignore?
                    // Wait, if the user says "rightmost", maybe it's lane index 3 (4th lane).
                    // My code: ['11', '12', '13', '14'].includes(ch) -> lane = ch - 11 (0,1,2,3).
                    // If the chart uses 15 for the 4th lane (IIDX 5th key), we miss it.
                    // Let's allow 15, 18, 19 and map them if possible, or just capture them.
                    // But for 4K specific charts, they should use 11-14.
                    // Unless it's a 5K/7K chart being played in 4K mode?
                    // Let's check if the chart uses 15, 16, 18, 19.
                    // Safe fix: Add 15, 16, 18, 19 to the check and map them.
                    // However, simply adding them might overlap.
                    // Let's assume standard contiguous 11-14 for now, but maybe the BMS uses 15?
                    // Let's check 11,12,13,14,15,16,18,19.
                    
                    // P1 Visible Notes
                    // Mapping based on key.txt:
                    // 11->L0, 12->L1, 13->L2, 16->L3 (Key 4), 17->L4, 18->L5, 19->L6
                    else if (['11', '12', '13', '14', '15', '16', '17', '18', '19'].includes(ch)) {
                        let lane = -1;
                        const n = parseInt(ch);
                        
                        if (n === 11) lane = 0;      // Key 1
                        else if (n === 12) lane = 1; // Key 2
                        else if (n === 13) lane = 2; // Key 3
                        else if (n === 16) lane = 3; // Key 4 (per key.txt)
                        else if (n === 17) lane = 4; // Key 5
                        else if (n === 18) lane = 5; // Key 6
                        else if (n === 19) lane = 6; // Key 7
                        
                        // 14 and 15 are marked as unused in key.txt
                        
                        if (lane >= 0) {
                            channelEvents.push({ beat, type: 'note', lane, valStr });
                        }
                    }
                    // P1 Long Notes (51-59)
                    else if (['51', '52', '53', '54', '55', '56', '57', '58', '59'].includes(ch)) {
                        let lane = -1;
                        const n = parseInt(ch);
                        
                        if (n === 51) lane = 0;      // Key 1
                        else if (n === 52) lane = 1; // Key 2
                        else if (n === 53) lane = 2; // Key 3
                        else if (n === 56) lane = 3; // Key 4
                        else if (n === 57) lane = 4; // Key 5
                        else if (n === 58) lane = 5; // Key 6
                        else if (n === 59) lane = 6; // Key 7

                         if (lane >= 0) {
                            channelEvents.push({ beat, type: 'ln', lane, valStr });
                        }
                    }
                }
            }
        }
        
        // Add '00' events for LNTYPE 2 handling if needed
        // The loop above skips '00'. We need to NOT skip '00' for LN channels if LNTYPE 2.
        // Let's fix the loop logic.


        // Sort time events
        timeEvents.sort((a, b) => a.beat - b.beat);
        channelEvents.sort((a, b) => a.beat - b.beat);

        // 3. Calculate Absolute Time
        // We iterate through beats and integrate time
        
        // Merge all event beats to process segments
        const criticalBeats = new Set();
        criticalBeats.add(0);
        timeEvents.forEach(e => criticalBeats.add(e.beat));
        channelEvents.forEach(e => criticalBeats.add(e.beat));
        
        const sortedBeats = Array.from(criticalBeats).sort((a, b) => a - b);
        
        const beatToTime = new Map(); // beat -> seconds
        let lastBeat = 0;
        let lastTime = 0;
        
        // Process time events pointer
        let teIdx = 0;
        
        this.bpms.push({ time: 0, bpm: initialBPM });
        
        for (const beat of sortedBeats) {
            const deltaBeats = beat - lastBeat;
            const secondsPerBeat = 60.0 / currentBPM;
            lastTime += deltaBeats * secondsPerBeat;
            beatToTime.set(beat, lastTime);
            
            // Process events at this exact beat
            while (teIdx < timeEvents.length && Math.abs(timeEvents[teIdx].beat - beat) < 1e-6) {
                const ev = timeEvents[teIdx];
                if (ev.type === 'bpm') {
                    currentBPM = ev.value;
                    this.bpms.push({ time: lastTime, bpm: currentBPM });
                } else if (ev.type === 'stop') {
                    // Stop is defined in ticks (1/192 of a measure = 1/48 of a beat in 4/4)
                    // Wait, rule says: "unit is 1/192 measure". 
                    // Assuming 4/4 measure, 1 beat = 48 ticks.
                    // Stop duration in beats = value / 48.
                    // But wait, does STOP pause the music? 
                    // In BMS, STOP stops the scroll but MUSIC continues.
                    // However, for a simulator, we usually map "chart time" vs "music time".
                    // If we map visual time, the chart stops scrolling.
                    // Let's handle STOP by adding a "visual delay" but keeping audio sync?
                    // Actually, STOP stops the scroll. The note time (audio time) is NOT affected usually?
                    // NO. STOP pauses the SEQUENCE. So music and notes shift?
                    // "The sequence stops for the duration". So subsequent notes are delayed.
                    // Yes, STOP adds delay to everything AFTER it.
                    
                    const stopBeats = ev.value / 48.0; // Assuming 192 ticks per measure (4 beats)
                    const stopTime = stopBeats * (60.0 / currentBPM);
                    lastTime += stopTime;
                    this.stops.push({ time: beatToTime.get(beat), duration: stopTime });
                }
                teIdx++;
            }
            
            lastBeat = beat;
        }
        
        this.duration = lastTime;

        // 4. Generate Notes with Time
        // Handle LNs: need to pair start/end
        // Expand pending array to cover more lanes if needed
        const lnPending = new Array(10).fill(null); 
        
        for (const ev of channelEvents) {
            const time = beatToTime.get(ev.beat);
            
            // Map lane for 4K if possible
            // If lane is 0,1,2,3 -> Keep
            // If lane is 4 (key 5) -> Map to 3? Or just ignore?
            // Many 4K BMS charts use 11,12,13,14.
            // Some might use 11,12,13,15.
            // Some might use 11,12,14,15.
            // Let's auto-map? No, that's dangerous.
            // But if the user says "rightmost track not reading", maybe it's lane index 4 (channel 15) that is being used?
            // Or maybe channel 14 IS being used but my previous code only checked 11,12,13,14 (0,1,2,3) which is correct.
            // Wait, in 7K standard: 11=1, 12=2, 13=3, 14=4, 15=5, 18=6, 19=7.
            // 4K is usually 1,2,3,4 (11-14).
            // If "rightmost track" is missing, maybe it's channel 15 (5th key) being used as 4th key?
            // Or maybe channel 18/19?
            // Let's keep the lane index as is, and let game.js handle the "Lane Count" or remapping.
            // But game.js expects lane 0-3.
            // If we receive lane 4 (from channel 15), game.js won't render it.
            // Let's try to remap lanes > 3 to 3 if it's a 4K chart?
            // Actually, let's just allow parsing ALL lanes, and let the game decide what to show.
            
            if (ev.type === 'note') {
                this.notes.push({
                    time: time,
                    lane: ev.lane,
                    type: 'tap',
                    duration: 0
                });
            } else if (ev.type === 'ln') {
                const lnType = parseInt(this.headers['LNTYPE'] || '1', 10);
                
                if (lnType === 2) {
                    if (ev.valStr === '00') {
                        // End LN if pending
                        if (lnPending[ev.lane]) {
                            const startNote = lnPending[ev.lane];
                            startNote.duration = time - startNote.time;
                            this.notes.push(startNote);
                            lnPending[ev.lane] = null;
                        }
                    } else {
                        // Start LN (if pending, force end previous)
                        if (lnPending[ev.lane]) {
                            const startNote = lnPending[ev.lane];
                            startNote.duration = time - startNote.time;
                            this.notes.push(startNote);
                        }
                        lnPending[ev.lane] = {
                            time: time,
                            lane: ev.lane,
                            type: 'ln',
                            duration: 0
                        };
                    }
                } else {
                    // LNTYPE 1 (Toggle)
                    if (lnPending[ev.lane] !== null) {
                        // End of LN
                        const startNote = lnPending[ev.lane];
                        startNote.duration = time - startNote.time;
                        this.notes.push(startNote);
                        lnPending[ev.lane] = null;
                    } else {
                        // Start of LN
                        lnPending[ev.lane] = {
                            time: time,
                            lane: ev.lane,
                            type: 'ln',
                            duration: 0 // placeholder
                        };
                    }
                }
            } else if (ev.type === 'bgm') {
                this.bgmEvents.push({
                    time: time,
                    id: ev.valStr
                });
            }
        }
        
        // Sort notes by time
        this.notes.sort((a, b) => a.time - b.time);
        this.bgmEvents.sort((a, b) => a.time - b.time);
        
        return {
            notes: this.notes,
            bgmEvents: this.bgmEvents,
            bpms: this.bpms,
            stops: this.stops,
            initialBPM: initialBPM,
            title: this.headers['TITLE'],
            artist: this.headers['ARTIST'],
            headers: this.headers // Export headers too for debugging
        };
    }
}
