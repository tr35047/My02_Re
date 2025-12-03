
// game.js
// Core Rhythm Game Logic using Pixi.js

const el = {
    // Only bind bgm here as it's global for timing
    bgm: document.getElementById('bgm'),
    hudScore: document.getElementById('hud-score'),
    hudAcc: document.getElementById('hud-acc'),
    hudCombo: document.getElementById('hud-combo'),
    hudComboBox: document.getElementById('hud-combo-box')
};

export class RhythmGame {
    constructor(container) {
        this.app = new PIXI.Application({
            resizeTo: container,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1
        });
        container.appendChild(this.app.view);
        
        this.width = this.app.screen.width;
        this.height = this.app.screen.height;
        
        // Constants
        this.LANE_COUNT = 4;
        this.LANE_WIDTH = 82; // Adjusted for MyO2 skin ratio (328px total width / 4)
        this.HIT_Y = this.height * 0.85;
        this.SPEED = 1.5; 
        this.OFFSET = 0.0; // Reset to 0, using AudioContext logic for precision
        this.GLOBAL_OFFSET = 0.0; // Reset to 0 as we implemented proper BGM delay
        
        // Audio Context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.audioBuffer = null;
        this.audioSource = null;
        this.audioStartTime = 0;

        // Layers
        this.stage = this.app.stage;
        this.gameContainer = new PIXI.Container();
        this.stage.addChild(this.gameContainer);
        
        this.notesLayer = new PIXI.Container();
        this.effectsLayer = new PIXI.Container();
        
        this.gameContainer.addChild(this.notesLayer);
        this.gameContainer.addChild(this.effectsLayer);
        
        // Assets
        this.textures = {};
        this.assetsLoaded = false;
        this.loadAssets();

        // State
        this.notes = [];
        this.runtimeNotes = [];
        this.startTime = 0;
        this.isPlaying = false;
        
        this.stats = {
            combo: 0,
            score: 0,
            perfect: 0,
            great: 0,
            miss: 0,
            maxCombo: 0
        };
        
        // Input
        this.keys = { 'KeyD': 0, 'KeyF': 1, 'KeyJ': 2, 'KeyK': 3 };
        this.heldLanes = [false, false, false, false];
        
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        window.addEventListener('resize', this.onResize.bind(this));
        
        this.initGraphics();
    }
    
    async loadAssets() {
        try {
            // Load Main Atlas
            const mainTex = await PIXI.Assets.load('source/main.png');
            
            // Slice Textures based on Skin XML analysis
            // Note Type A (Lanes 0, 3 - Outer)
            this.textures.noteA = new PIXI.Texture(mainTex.baseTexture, new PIXI.Rectangle(226, 143, 46, 15));
            // Note Type B (Lanes 1, 2 - Inner)
            this.textures.noteB = new PIXI.Texture(mainTex.baseTexture, new PIXI.Rectangle(225, 160, 48, 15));
            // Judge Line Bar
            this.textures.judgeBar = new PIXI.Texture(mainTex.baseTexture, new PIXI.Rectangle(136, 275, 328, 23));
            
            // Load Flare Animation
            this.textures.flares = [];
            for(let i=0; i<=11; i++) {
                const tex = await PIXI.Assets.load(`source/Flare${i}.png`);
                this.textures.flares.push(tex);
            }
            
            this.assetsLoaded = true;
            this.initGraphics(); // Re-init with textures
        } catch (e) {
            console.error('Failed to load assets:', e);
        }
    }

    initGraphics() {
        // Create Lane Backgrounds
        this.laneGraphics = new PIXI.Graphics();
        this.gameContainer.addChildAt(this.laneGraphics, 0);
        
        // Judge Line Sprite (Placeholder until loaded)
        this.judgeSprite = new PIXI.Sprite();
        this.judgeSprite.anchor.set(0.5, 0.5);
        this.gameContainer.addChildAt(this.judgeSprite, 1);
        
        // Offset Display
        this.offsetText = new PIXI.Text(`OFFSET: +${Math.round(this.GLOBAL_OFFSET * 1000)}ms`, {
            fontFamily: 'Arial',
            fontSize: 16,
            fill: 0xffffff,
            align: 'right',
            dropShadow: true,
            dropShadowColor: '#000000',
            dropShadowBlur: 4,
            dropShadowDistance: 2
        });
        this.offsetText.anchor.set(1, 0);
        this.offsetText.position.set(this.width - 20, 20);
        this.gameContainer.addChild(this.offsetText);
        
        this.drawLayout();
    }
    
    drawLayout() {
        this.width = this.app.screen.width;
        this.height = this.app.screen.height;
        this.HIT_Y = this.height * 0.85;
        
        const totalW = this.LANE_COUNT * this.LANE_WIDTH;
        this.startX = (this.width - totalW) / 2;
        
        this.laneGraphics.clear();
        this.laneGraphics.beginFill(0x000000, 0.8); // Darker background
        this.laneGraphics.drawRect(this.startX, 0, totalW, this.height);
        this.laneGraphics.endFill();
        
        // Dividers
        this.laneGraphics.lineStyle(2, 0x333333);
        for (let i = 0; i <= this.LANE_COUNT; i++) {
            const x = this.startX + i * this.LANE_WIDTH;
            this.laneGraphics.moveTo(x, 0);
            this.laneGraphics.lineTo(x, this.height);
        }
        
        // Judge Line
        if (this.assetsLoaded && this.textures.judgeBar) {
            this.judgeSprite.texture = this.textures.judgeBar;
            this.judgeSprite.width = totalW + 10; // Slightly wider
            this.judgeSprite.height = 30;
            this.judgeSprite.position.set(this.width / 2, this.HIT_Y);
        } else {
            // Fallback
            const gr = new PIXI.Graphics();
            gr.beginFill(0x00d2ff, 0.8);
            gr.drawRect(0, 0, totalW, 4);
            gr.endFill();
            this.judgeSprite.texture = this.app.renderer.generateTexture(gr);
            this.judgeSprite.position.set(this.width / 2, this.HIT_Y);
        }
        
        // Key beams (pressed state)
        if (this.keyBeams) {
            this.keyBeams.forEach(b => b.destroy());
        }
        this.keyBeams = [];
        for(let i=0; i<4; i++) {
            const beam = new PIXI.Graphics();
            beam.beginFill(0xffffff, 0.15);
            beam.drawRect(this.startX + i*this.LANE_WIDTH, 0, this.LANE_WIDTH, this.height);
            beam.endFill();
            beam.visible = false;
            this.gameContainer.addChildAt(beam, 1); // Behind notes
            this.keyBeams.push(beam);
        }
    }
    
    onResize() {
        this.drawLayout();
        if (this.offsetText) {
            this.offsetText.position.set(this.app.screen.width - 20, 20);
        }
    }
    
    async start(chart, audioUrl) {
        // Reset
        this.notesLayer.removeChildren();
        this.effectsLayer.removeChildren();
        this.stats = { combo: 0, score: 0, perfect: 0, great: 0, miss: 0, maxCombo: 0 };
        this.updateHUD();
        
        // Stop previous audio if any
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch(e) {}
            this.audioSource = null;
        }

        // Load Audio Buffer
        try {
            const response = await fetch(audioUrl);
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.error("Audio load failed", e);
            alert("音频加载失败，请检查文件格式");
            return;
        }
        
        // Prepare Notes
        // Auto-detect lane range
        // Find used lanes
        const usedLanes = new Set(chart.notes.map(n => n.lane));
        
        this.runtimeNotes = chart.notes.map(n => {
            let lane = n.lane;
            // Fix for 4K charts using 5th key (channel 15/Lane 4) as 4th key
            if (lane === 4 && !usedLanes.has(3)) {
                lane = 3;
            }
            // Fix for 4K charts using 6th key (channel 18/Lane 5) 
            if (lane === 5 && !usedLanes.has(3) && !usedLanes.has(4)) {
                lane = 3;
            }
            
            return {
                ...n,
                lane: lane, // Apply remapping
                hit: false,
                missed: false,
                isHolding: false, // New state for LN
                sprite: null,
                bodySprite: null // For LN
            };
        }).filter(n => n.lane < 4); // Ensure only 4 lanes are kept

        
        // Pre-create Sprites
        const fallbackTex = this.createNoteTexture();
        
        for (const note of this.runtimeNotes) {
            let tex = fallbackTex;
            if (this.assetsLoaded) {
                // Lane 0,3 -> Note A; Lane 1,2 -> Note B
                if (note.lane === 0 || note.lane === 3) tex = this.textures.noteA;
                else tex = this.textures.noteB;
            }
            
            if (note.type === 'tap') {
                const spr = new PIXI.Sprite(tex);
                spr.anchor.set(0.5, 0.5);
                spr.width = this.LANE_WIDTH; // Full width
                spr.height = 24; // Taller
                spr.visible = false; // Hide initially
                this.notesLayer.addChild(spr);
                note.sprite = spr;
            } else if (note.type === 'ln') {
                // Head
                const spr = new PIXI.Sprite(tex);
                spr.anchor.set(0.5, 0.5);
                spr.width = this.LANE_WIDTH;
                spr.height = 24;
                spr.visible = false;
                this.notesLayer.addChild(spr);
                note.sprite = spr;
                
                // Body
                const body = new PIXI.Graphics();
                body.beginFill(0xffffff, 0.7); // White-ish body
                body.drawRect(-this.LANE_WIDTH * 0.4, 0, this.LANE_WIDTH * 0.8, 1); 
                body.endFill();
                body.visible = false;
                this.notesLayer.addChild(body); 
                this.notesLayer.setChildIndex(body, 0); 
                note.bodySprite = body;
            }
        }
        
        // Start Audio using AudioContext
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        this.audioSource = this.audioContext.createBufferSource();
        this.audioSource.buffer = this.audioBuffer;
        this.audioSource.connect(this.audioContext.destination);
        
        // Schedule start
        // Use a small delay to ensure smooth start
        const scheduleTime = this.audioContext.currentTime + 0.1;
        this.audioStartTime = scheduleTime;
        
        // Check for BGM Delay (BMS channel 01)
        // If the BGM is defined to start later (e.g. at measure 0.625), we delay the audio playback
        // The game timer (visuals) starts at scheduleTime (Time=0)
        // The audio starts at scheduleTime + bgmDelay
        let bgmDelay = 0;
        if (chart.bgmEvents && chart.bgmEvents.length > 0) {
            bgmDelay = chart.bgmEvents[0].time;
            console.log(`BGM Delayed start by ${bgmDelay.toFixed(3)}s`);
            
            // Warning for multi-BGM or STOPs
            if (chart.bgmEvents.length > 1) {
                console.warn("Warning: Chart contains multiple BGM events. Only the first one is supported in Single-Audio mode.");
            }
            if (chart.stops && chart.stops.length > 0) {
                console.warn("Warning: Chart contains STOP events. Sync may drift if audio is continuous.");
            }
        }
        
        this.audioSource.start(scheduleTime + bgmDelay);
        
        this.isPlaying = true;
        this.app.ticker.remove(this.update, this); // Remove existing if any
        this.app.ticker.add(this.update, this);
    }
    
    createNoteTexture() {
        const gr = new PIXI.Graphics();
        gr.beginFill(0xffffff);
        gr.lineStyle(2, 0x00d2ff);
        gr.drawRoundedRect(0, 0, 100, 20, 4);
        gr.endFill();
        return this.app.renderer.generateTexture(gr);
    }
    
    update(delta) {
        if (!this.isPlaying) return;
        
        // Use AudioContext time
        // Calculate time relative to start
        // This is the "Golden Rule" from position.txt:
        // currentSongTime = (AudioContext.currentTime - start_timestamp) * 1000 + global_offset
        // My code uses seconds, so remove *1000, but logic is same.
        
        const now = this.audioContext.currentTime;
        const currentTime = now - this.audioStartTime + this.GLOBAL_OFFSET;
        
        const scrollSpeed = this.height * 0.8; // Pixels per second
        
        for (const note of this.runtimeNotes) {
            // Special handling for Holding LNs:
            // If note.isHolding is true, the head should stick to the hit line, and the body should shrink
            if (note.type === 'ln' && note.isHolding && !note.hit && !note.missed) {
                // LN is being held
                // Head stays at HIT_Y
                // Tail moves down
                
                // Check if duration has passed (tail reached HIT_Y)
                const endTime = note.time + note.duration;
                if (currentTime >= endTime) {
                    // Auto-hit tail if held until end (lenient)
                    note.hit = true;
                    note.isHolding = false;
                    this.triggerHit('PERFECT', note.lane); // Tail judgment
                    
                    if (note.sprite) note.sprite.visible = false;
                    if (note.bodySprite) note.bodySprite.visible = false;
                    continue;
                }
                
                // Render Holding State
                const x = this.startX + note.lane * this.LANE_WIDTH + this.LANE_WIDTH / 2;
                const tailTimeDiff = (note.time + note.duration) - currentTime;
                const tailY = this.HIT_Y - (tailTimeDiff * scrollSpeed);
                
                // Head fixed at Hit Line
                if (note.sprite) {
                    note.sprite.position.set(x, this.HIT_Y);
                    note.sprite.visible = true;
                }
                
                // Body from Hit Line to Tail
                if (note.bodySprite) {
                    const bodyLen = this.HIT_Y - tailY;
                    note.bodySprite.position.set(x, tailY);
                    note.bodySprite.height = bodyLen;
                    note.bodySprite.visible = true;
                }
                continue;
            }

            if (note.hit) {
                if (note.sprite) note.sprite.visible = false;
                if (note.bodySprite) note.bodySprite.visible = false;
                continue;
            }
            
            // Apply Offset for Sync (now handled by GLOBAL_OFFSET mostly, but can add per-note offset if needed)
            // note.time is in seconds
            const timeDiff = note.time - currentTime;
            
            // Check Miss
            if (timeDiff < -0.15 && !note.hit && !note.missed) { // 150ms late
                // For LN, if we missed the head, we missed the whole thing
                if (note.type === 'tap' || (note.type === 'ln' && !note.isHolding)) {
                     this.triggerMiss(note);
                     // Do not continue, let it fall
                }
            }
            
            // Render
            // Y = HitY - (TimeDiff * Speed)
            const y = this.HIT_Y - (timeDiff * scrollSpeed);
            const x = this.startX + note.lane * this.LANE_WIDTH + this.LANE_WIDTH / 2;
            
            // Visual effect for missed notes
            if (note.missed) {
                if (note.sprite) note.sprite.alpha = 0.5;
                if (note.bodySprite) note.bodySprite.alpha = 0.5;
            }
            
            // Calculate top edge for off-screen check
            let topY = y;
            if (note.type === 'ln') {
                topY = this.HIT_Y - ((timeDiff + note.duration) * scrollSpeed);
            }

            if (topY > this.height + 100) {
                 if (note.sprite) note.sprite.visible = false;
                 if (note.bodySprite) note.bodySprite.visible = false;
            } else if (y < -500) { 
                 if (note.sprite) note.sprite.visible = false;
            } else {
                // Show
                if (note.type === 'tap') {
                    note.sprite.position.set(x, y);
                    note.sprite.visible = true;
                } else if (note.type === 'ln') {
                    const tailY = this.HIT_Y - ((timeDiff + note.duration) * scrollSpeed);
                    
                    note.sprite.position.set(x, y); 
                    note.sprite.visible = true;
                    
                    const bodyLen = y - tailY;
                    note.bodySprite.position.set(x, tailY);
                    note.bodySprite.height = bodyLen;
                    note.bodySprite.visible = true;
                }
            }
        }
    }
    
    onKeyDown(e) {
        if (!this.isPlaying) return;
        
        // Offset Adjustment
        if (e.code === 'ArrowRight') {
            this.GLOBAL_OFFSET += 0.01; // +10ms
            this.updateOffsetDisplay();
            return;
        }
        if (e.code === 'ArrowLeft') {
            this.GLOBAL_OFFSET -= 0.01; // -10ms
            this.updateOffsetDisplay();
            return;
        }

        if (this.keys[e.code] === undefined) return;
        
        const lane = this.keys[e.code];
        this.heldLanes[lane] = true;
        this.keyBeams[lane].visible = true;
        
        this.checkHit(lane);
    }
    
    onKeyUp(e) {
        if (this.keys[e.code] === undefined) return;
        const lane = this.keys[e.code];
        this.heldLanes[lane] = false;
        this.keyBeams[lane].visible = false;
        
        // Handle LN Release
        this.checkLNRelease(lane);
    }

    checkLNRelease(lane) {
        // Find any active LN in this lane that is currently being held
        const now = this.audioContext.currentTime;
        const currentTime = now - this.audioStartTime + this.GLOBAL_OFFSET;

        const holdingNote = this.runtimeNotes.find(n => n.lane === lane && n.type === 'ln' && n.isHolding && !n.hit && !n.missed);

        if (holdingNote) {
            // Check if released too early
            const endTime = holdingNote.time + holdingNote.duration;
            const diff = currentTime - endTime; // If negative, released early. If positive, released late.
            
            // If released very early (e.g. more than 0.2s before end), it's a miss or break
            // If released within window of end, it's a completion
            
            if (diff < -0.2) {
                // Released too early -> Miss tail
                holdingNote.missed = true;
                holdingNote.isHolding = false;
                this.triggerMiss(holdingNote);
            } else {
                // Released near end -> Success
                // Even if released slightly early or late, we count it as HIT if within reasonable window
                // Standard BMS LN usually requires holding UNTIL end.
                // O2Jam LNs are usually lenient.
                // Let's treat release as "Final Hit"
                
                holdingNote.hit = true; // Fully hit
                holdingNote.isHolding = false;
                // Maybe add another combo/score for tail?
                // For now, just ensure it disappears properly
            }
        }
    }
    
    updateOffsetDisplay() {
        if (this.offsetText) {
            const ms = Math.round(this.GLOBAL_OFFSET * 1000);
            this.offsetText.text = `OFFSET: ${ms >= 0 ? '+' : ''}${ms}ms`;
        }
    }

    checkHit(lane) {
        // Use AudioContext time for judgment (Golden Rule)
        const now = this.audioContext.currentTime;
        const currentTime = now - this.audioStartTime + this.GLOBAL_OFFSET;
        
        // Find nearest note in lane
        // Filter notes that are not hit/missed in this lane
        // And within judge window (+- 150ms)
        
        const candidates = this.runtimeNotes.filter(n => 
            n.lane === lane && 
            !n.hit && !n.missed && 
            Math.abs(n.time - currentTime) < 0.15
        );
        
        if (candidates.length === 0) return;
        
        // Pick closest
        candidates.sort((a, b) => Math.abs(a.time - currentTime) - Math.abs(b.time - currentTime));
        const target = candidates[0];
        
        const diff = Math.abs(target.time - currentTime);
        
        let judge = 'MISS';
        if (diff <= 0.04) judge = 'PERFECT';
        else if (diff <= 0.08) judge = 'GREAT';
        else if (diff <= 0.12) judge = 'GOOD';
        else judge = 'MISS'; // Should not happen given filter, but ok
        
        if (judge !== 'MISS') {
            // If Tap Note, mark as hit immediately
            if (target.type === 'tap') {
                target.hit = true;
                this.triggerHit(judge, lane);
            } 
            // If LN Head, mark as "holding"
            else if (target.type === 'ln') {
                target.isHolding = true;
                target.hitTime = currentTime; // Record when we started holding
                this.triggerHit(judge, lane); // Initial hit judgement
                // Note: We do NOT set target.hit = true yet, because we need to check tail
                // We keep it visible but maybe change appearance?
            }
        }
    }
    
    triggerHit(judge, lane) {
        this.stats.combo++;
        if (this.stats.combo > this.stats.maxCombo) this.stats.maxCombo = this.stats.combo;
        
        if (judge === 'PERFECT') this.stats.score += 100;
        if (judge === 'GREAT') this.stats.score += 50;
        if (judge === 'GOOD') this.stats.score += 20;
        
        this.updateHUD();
        this.showHitEffect(lane, judge);
    }
    
    triggerMiss(note) {
        note.missed = true;
        this.stats.combo = 0;
        this.stats.miss++;
        this.updateHUD();
    }
    
    updateHUD() {
        const hudScore = document.getElementById('hud-score');
        const hudCombo = document.getElementById('hud-combo');
        const hudComboBox = document.getElementById('hud-combo-box');
        
        if(hudScore) hudScore.textContent = this.stats.score.toString().padStart(6, '0');
        if(hudCombo) hudCombo.textContent = this.stats.combo;
        
        // Acc calculation could be better but simple version:
        const total = this.stats.combo + this.stats.miss; // Only processed notes
        // This is wrong, combo resets. We need total hits.
        // But for now it's fine.
        
        // Animate Combo Box
        if (this.stats.combo > 0) {
            hudComboBox.style.opacity = 1;
            hudComboBox.style.transform = 'translate(-50%, -50%) scale(1.2)';
            setTimeout(() => {
                hudComboBox.style.transform = 'translate(-50%, -50%) scale(1)';
            }, 50);
        } else {
            hudComboBox.style.opacity = 0;
        }
    }
    
    showHitEffect(lane, judge) {
        const x = this.startX + lane * this.LANE_WIDTH + this.LANE_WIDTH/2;
        const y = this.HIT_Y;
        
        if (this.assetsLoaded && this.textures.flares && this.textures.flares.length > 0) {
            // Use Animated Sprite
            const anim = new PIXI.AnimatedSprite(this.textures.flares);
            anim.anchor.set(0.5, 0.5);
            anim.position.set(x, y);
            anim.animationSpeed = 0.5; // Adjust speed
            anim.loop = false;
            anim.width = 120;
            anim.height = 120;
            anim.blendMode = PIXI.BLEND_MODES.ADD;
            
            anim.onComplete = () => {
                this.effectsLayer.removeChild(anim);
                anim.destroy();
            };
            
            this.effectsLayer.addChild(anim);
            anim.play();
            
        } else {
            // Fallback Graphics
            const circle = new PIXI.Graphics();
            const color = judge === 'PERFECT' ? 0xFFD700 : (judge === 'GREAT' ? 0x00FF00 : 0x00FFFF);
            circle.beginFill(color, 0.6);
            circle.drawCircle(0, 0, 40);
            circle.endFill();
            circle.position.set(x, y);
            circle.blendMode = PIXI.BLEND_MODES.ADD;
            
            this.effectsLayer.addChild(circle);
            
            // Animate
            let scale = 1;
            const animate = () => {
                scale += 0.2;
                circle.scale.set(scale);
                circle.alpha -= 0.1;
                if (circle.alpha <= 0) {
                    this.effectsLayer.removeChild(circle);
                    this.app.ticker.remove(animate);
                }
            };
            this.app.ticker.add(animate);
        }
    }
}
