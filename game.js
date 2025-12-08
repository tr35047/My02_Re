
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

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

export class RhythmGame {
    constructor(container) {
        this.app = new PIXI.Application({
            resizeTo: container,
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1
        });
        container.appendChild(this.app.view);
        
        // Set logical resolution
        this.width = DESIGN_WIDTH;
        this.height = DESIGN_HEIGHT;

        try {
            this._resizeObserver = new ResizeObserver(() => {
                this.onResize();
            });
            this._resizeObserver.observe(container);
        } catch(e) {}
        
        // Constants
        this.LANE_COUNT = 4;
        this.LANE_WIDTH = 333 / 4; // Adjusted for 333px total width
        this.HIT_Y = this.height - 108; // Moved down by 42px (was -150)
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

        // Background Layer
        this.bgSprite = new PIXI.Sprite();
        this.bgSprite.anchor.set(0.5, 0.5);
        this.gameContainer.addChild(this.bgSprite);
        
        // Internal Layers for proper Z-indexing
        this.laneLayer = new PIXI.Container();
        this.judgeLayer = new PIXI.Container();
        this.keyLayer = new PIXI.Container();
        this.notesLayer = new PIXI.Container();
        this.effectsLayer = new PIXI.Container();
        
        this.gameContainer.addChild(this.laneLayer);
        this.gameContainer.addChild(this.judgeLayer);
        this.gameContainer.addChild(this.keyLayer);
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
            cool: 0,
            good: 0,
            bad: 0,
            miss: 0,
            maxCombo: 0,
            comboBonus: 0,
            hp: 100
        };
        
        // Input
        this.keys = { 'KeyD': 3, 'KeyF': 0, 'KeyJ': 1, 'KeyK': 2 };
        this.heldLanes = [false, false, false, false];
        this.laneColumn = [1, 2, 3, 0];
        this.speedMultiplier = 1;
        this.autoDemo = false;
        
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        window.addEventListener('resize', this.onResize.bind(this));
        
        this.initGraphics();
    }
    
    async loadAssets() {
        try {
            // Load individual textures from source folder
            this.textures.bg = await PIXI.Assets.load('source/BG2.png');
            this.textures.note1 = await PIXI.Assets.load('source/note1.png');
            this.textures.note2 = await PIXI.Assets.load('source/note2.png');
            this.textures.ln1 = await PIXI.Assets.load('source/ln1.png');
            this.textures.ln2 = await PIXI.Assets.load('source/ln2.png');
            
            // Assign textures based on lane type
            // Outer lanes (0, 3) use note1/ln1
            // Inner lanes (1, 2) use note2/ln2
            this.textures.noteA = this.textures.note1;
            this.textures.noteB = this.textures.note2;
            this.textures.lnA = this.textures.ln1;
            this.textures.lnB = this.textures.ln2;

            // Judge Line Image (Removed)
            // this.textures.judgeLine = await PIXI.Assets.load('source/pd.png');
            
            // Key Press Images (Removed)
            // this.textures.keys = [];
            /*
            for(let i=1; i<=4; i++) {
                const tex = await PIXI.Assets.load(`source/key${i}.png`);
                this.textures.keys.push(tex);
            }
            */

            // Judgment Images
            this.textures.judgments = {
                cool: await PIXI.Assets.load('source/cool.png'),
                good: await PIXI.Assets.load('source/good.png'),
                bad: await PIXI.Assets.load('source/bad.png'),
                miss: await PIXI.Assets.load('source/miss.png')
            };
            
            // Load Flare Animation
            this.textures.flares = [];
            for(let i=0; i<=11; i++) {
                const tex = await PIXI.Assets.load(`source/Flare${i}.png`);
                this.textures.flares.push(tex);
            }
            
            // Combo Digits
            this.textures.comboDigits = [];
            for (let d = 0; d <= 9; d++) {
                const dtex = await PIXI.Assets.load(`source/c${d}.png`);
                this.textures.comboDigits.push(dtex);
            }
            
            this.assetsLoaded = true;
            this.initGraphics(); // Re-init with textures
        } catch (e) {
            console.error('Failed to load assets:', e);
        }
    }

    initGraphics() {
        // Background
        if (this.assetsLoaded && this.textures.bg) {
            this.bgSprite.texture = this.textures.bg;
        }

        // Create Lane Backgrounds
        this.laneGraphics = new PIXI.Graphics();
        this.laneLayer.addChild(this.laneGraphics);
        
        // Judge Line Sprite (Placeholder until loaded)
        this.judgeSprite = new PIXI.Sprite();
        this.judgeSprite.anchor.set(0.5, 0.5);
        this.judgeSprite.visible = false; // Hidden as requested
        this.judgeLayer.addChild(this.judgeSprite);
        
        // Key Press Sprites (Removed)
        this.keySprites = [];
        /*
        for(let lane=0; lane<4; lane++) {
            const spr = new PIXI.Sprite();
            spr.anchor.set(0.5, 1); // Anchor at bottom center
            spr.visible = false;
            this.keyLayer.addChild(spr); 
            this.keySprites[lane] = spr;
        }
        */

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
        this.speedText = new PIXI.Text(`SPEED: x${this.speedMultiplier}`, {
            fontFamily: 'Arial',
            fontSize: 16,
            fill: 0xffffff,
            align: 'right',
            dropShadow: true,
            dropShadowColor: '#000000',
            dropShadowBlur: 4,
            dropShadowDistance: 2
        });
        this.speedText.anchor.set(1, 0);
        this.speedText.position.set(this.width - 20, 44);
        this.gameContainer.addChild(this.speedText);
        this.comboSprite = new PIXI.Sprite(this.textures.tCombo || PIXI.Texture.EMPTY);
        this.comboSprite.anchor.set(0.5, 0.5);
        this.comboSprite.visible = false;
        this.comboSprite.position.set(this.width / 2, this.height * 0.24);
        this.effectsLayer.addChild(this.comboSprite);
        this.comboDigits = new PIXI.Container();
        this.comboDigits.visible = false;
        this.comboDigits.position.set(this.width / 2, this.height * 0.30);
        this.effectsLayer.addChild(this.comboDigits);
        
        this.drawLayout();
    }
    
    drawLayout() {
        // Ensure we are using design resolution
        this.width = DESIGN_WIDTH;
        this.height = DESIGN_HEIGHT;
        this.HIT_Y = this.height - 123;
        
        // Background Scaling (Fit Height)
        if (this.bgSprite.texture && this.bgSprite.texture !== PIXI.Texture.EMPTY) {
            const scale = this.height / this.bgSprite.texture.height;
            this.bgSprite.scale.set(scale);
            this.bgSprite.position.set(this.width / 2, this.height / 2);
            
            // Recalculate LANE_WIDTH based on BG width
            // User requested: Track Width = BG Width - 88 (44px on each side)
            const bgDisplayWidth = this.bgSprite.texture.width * scale;
            const trackWidth = bgDisplayWidth - 106;
            this.LANE_WIDTH = trackWidth / this.LANE_COUNT;
        }

        const totalW = this.LANE_COUNT * this.LANE_WIDTH;
        this.startX = (this.width - totalW) / 2;
        
        this.laneGraphics.clear();
        
        // Judge Line
        if (this.assetsLoaded && this.textures.judgeLine) {
            this.judgeSprite.texture = this.textures.judgeLine;
            this.judgeSprite.width = totalW;
            this.judgeSprite.scale.y = this.judgeSprite.scale.x; // Keep aspect ratio
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
        this.judgeSprite.visible = false; // Ensure it remains hidden
        
        // Create/Update Mask for Game Area
        // User request: Reduce bottom to JudgeLine - 9px
        if (!this.areaMask) {
            this.areaMask = new PIXI.Graphics();
            this.gameContainer.addChild(this.areaMask);
        }
        this.areaMask.clear();
        this.areaMask.beginFill(0xffffff);
        // Draw from top (including off-screen notes above) to HIT_Y - 9
        // Using a large negative y to ensure we cover notes spawning above
        this.areaMask.drawRect(0, -2000, this.width, (this.HIT_Y + 9) + 2000); 
        this.areaMask.endFill();
        
        // Apply mask to relevant layers
        this.laneLayer.mask = this.areaMask;
        this.notesLayer.mask = this.areaMask;
        this.keyLayer.mask = this.areaMask;
        this.judgeLayer.mask = this.areaMask;
        
        // Key beams (pressed state) -> Replaced by Key Images
        if (this.keyBeams) {
            this.keyBeams.forEach(b => b.destroy());
        }
        this.keyBeams = []; // Keep array but empty to avoid errors if referenced
    }
    
    onResize() {
        const sw = window.innerWidth;
        const sh = window.innerHeight;

        const scale = Math.min(sw / DESIGN_WIDTH, sh / DESIGN_HEIGHT);

        this.gameContainer.scale.set(scale);
        this.gameContainer.position.set(
            (sw - DESIGN_WIDTH * scale) / 2,
            (sh - DESIGN_HEIGHT * scale) / 2
        );
    }
    
    async start(chart, audioUrl) {
        // Reset
        this.notesLayer.removeChildren();
        this.effectsLayer.removeChildren();
        this.stats = { combo: 0, score: 0, cool: 0, good: 0, bad: 0, miss: 0, maxCombo: 0, comboBonus: 0, hp: 100 };
        if (this.comboSprite) {
            this.comboSprite.visible = false;
            this.effectsLayer.addChild(this.comboSprite);
        }
        if (this.comboDigits) {
            this.comboDigits.visible = false;
            this.comboDigits.scale.set(1);
            this.comboDigits.removeChildren();
            this.effectsLayer.addChild(this.comboDigits);
        }
        const failTitle = document.getElementById('fail-title');
        if (failTitle) failTitle.style.opacity = 0;
        this.updateHUD();
        const self = this;
        if (this.audioSource) this.audioSource.onended = () => {
            const r = { cool: self.stats.cool || 0, good: self.stats.good || 0, bad: self.stats.bad || 0, miss: self.stats.miss || 0, maxCombo: self.stats.maxCombo || 0 };
            self.lastResults = r;
            const btnExit = document.getElementById('btn-exit');
            if (btnExit) btnExit.click();
        };
        
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
            let noteTex = fallbackTex;
            let bodyTex = fallbackTex;
            if (this.assetsLoaded) {
                if (note.lane === 0) {
                    noteTex = this.textures.noteB;
                    bodyTex = this.textures.ln2;
                } else if (note.lane === 1) {
                    noteTex = this.textures.noteB; // swapped with lane 3
                    bodyTex = this.textures.ln2;
                } else if (note.lane === 2) {
                    noteTex = this.textures.noteA; // paired with lane 4 after swap
                    bodyTex = this.textures.ln1;
                } else if (note.lane === 3) {
                    noteTex = this.textures.noteA; // swapped from noteB
                    bodyTex = this.textures.ln1;
                }
            }
            
            if (note.type === 'tap') {
                const spr = new PIXI.Sprite(noteTex);
                spr.anchor.set(0.5, 0.5);
                spr.width = this.LANE_WIDTH; // Full width
                spr.scale.y = spr.scale.x; // Maintain aspect ratio for notes
                spr.visible = false; // Hide initially
                this.notesLayer.addChild(spr);
                note.sprite = spr;
            } else if (note.type === 'ln') {
                // Head
                const spr = new PIXI.Sprite(noteTex);
                spr.anchor.set(0.5, 0.5);
                spr.width = this.LANE_WIDTH;
                spr.scale.y = spr.scale.x; // Maintain aspect ratio for LN head
                spr.visible = false;
                this.notesLayer.addChild(spr);
                note.sprite = spr;

                // Tail
                const tailSpr = new PIXI.Sprite(noteTex);
                tailSpr.anchor.set(0.5, 0.5);
                tailSpr.width = this.LANE_WIDTH;
                tailSpr.scale.y = tailSpr.scale.x;
                tailSpr.visible = false;
                this.notesLayer.addChild(tailSpr);
                note.tailSprite = tailSpr;
                
                // Body
                const body = new PIXI.Sprite(bodyTex);
                body.anchor.set(0.5, 0); // Top-center
                body.width = this.LANE_WIDTH;
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
        this.audioSource.onended = () => {
            const btnExit = document.getElementById('btn-exit');
            if (btnExit) btnExit.click();
        };
        
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
        
        const scrollSpeed = this.height * 0.8 * this.speedMultiplier;
        
        for (const note of this.runtimeNotes) {
            if (this.autoDemo && !note.hit && !note.missed) {
                if (note.type === 'ln') {
                    if (!note.isHolding && currentTime >= note.time) {
                        note.isHolding = true;
                        note.hitTime = currentTime;
                        this.triggerHit('COOL', note.lane);
                    }
                } else if (note.type === 'tap') {
                    if (Math.abs(note.time - currentTime) <= 0.03) {
                        note.hit = true;
                        this.triggerHit('COOL', note.lane);
                        if (note.sprite) note.sprite.visible = false;
                        continue;
                    }
                }
            }
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
                    this.triggerHit('COOL', note.lane); // Tail judgment
                    
                    if (note.sprite) note.sprite.visible = false;
                    if (note.bodySprite) note.bodySprite.visible = false;
                    if (note.tailSprite) note.tailSprite.visible = false;
                    continue;
                }
                
                // Render Holding State
                const x = this.startX + (this.laneColumn[note.lane] ?? note.lane) * this.LANE_WIDTH + this.LANE_WIDTH / 2;
                const tailTimeDiff = (note.time + note.duration) - currentTime;
                const tailY = this.HIT_Y - (tailTimeDiff * scrollSpeed);
                
                // Head fixed at Hit Line
                if (note.sprite) {
                    note.sprite.position.set(x, this.HIT_Y);
                    note.sprite.visible = true;
                }

                if (note.tailSprite) {
                    note.tailSprite.position.set(x, tailY);
                    note.tailSprite.visible = true;
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
                if (note.tailSprite) note.tailSprite.visible = false;
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
            const x = this.startX + (this.laneColumn[note.lane] ?? note.lane) * this.LANE_WIDTH + this.LANE_WIDTH / 2;
            
            // Visual effect for missed notes
            if (note.missed) {
                if (note.sprite) note.sprite.alpha = 0.5;
                if (note.bodySprite) note.bodySprite.alpha = 0.5;
                if (note.tailSprite) note.tailSprite.alpha = 0.5;
            }
            
            // Calculate top edge for off-screen check
            let topY = y;
            if (note.type === 'ln') {
                topY = this.HIT_Y - ((timeDiff + note.duration) * scrollSpeed);
            }

            if (topY > this.height + 100) {
                 if (note.sprite) note.sprite.visible = false;
                 if (note.bodySprite) note.bodySprite.visible = false;
                 if (note.tailSprite) note.tailSprite.visible = false;
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
                    
                    if (note.tailSprite) {
                        note.tailSprite.position.set(x, tailY);
                        note.tailSprite.visible = true;
                    }

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
        
        // Show Key Sprite (Removed)
        /*
        if (this.keySprites && this.keySprites[lane]) {
            this.keySprites[lane].visible = true;
        }
        */
        
        this.checkHit(lane);
    }
    
    onKeyUp(e) {
        if (this.keys[e.code] === undefined) return;
        const lane = this.keys[e.code];
        this.heldLanes[lane] = false;
        
        // Hide Key Sprite (Removed)
        /*
        if (this.keySprites && this.keySprites[lane]) {
            this.keySprites[lane].visible = false;
        }
        */
        
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
    updateSpeedDisplay() {
        if (this.speedText) {
            const val = Number.isInteger(this.speedMultiplier) ? this.speedMultiplier.toFixed(0) : this.speedMultiplier.toFixed(1);
            this.speedText.text = `SPEED: x${val}`;
        }
    }
    updateComboDigits() {
        if (!this.comboDigits || !this.textures.comboDigits) return;
        const value = this.stats.combo;
        if (value <= 0) { this.comboDigits.visible = false; return; }
        const str = String(value);
        this.comboDigits.removeChildren();
        const sprites = [];
        let totalW = 0;
        const H = 128; // Doubled size (was 128)
        const F = 1.0;
        for (const ch of str) {
            const idx = parseInt(ch, 10);
            const tex = this.textures.comboDigits[idx];
            const spr = new PIXI.Sprite(tex);
            spr.anchor.set(0.5, 0.5);
            // Maintain aspect ratio
            if (tex.height > 0) {
                const s = H / tex.height;
                spr.scale.set(s);
            } else {
                spr.height = H; // Fallback
            }
            sprites.push(spr);
            totalW += spr.width * F;
        }
        let x = -totalW / 2;
        for (const spr of sprites) {
            spr.position.set(x + (spr.width * F) / 2, 0);
            this.comboDigits.addChild(spr);
            x += spr.width * F;
        }
        this.comboDigits.visible = true;
    }

    bounceCombo() {
        if (!this.comboDigits) return;
        if (this.comboBounceTick) this.app.ticker.remove(this.comboBounceTick);
        let t = 0;
        const dur = 120;
        const startScale = 1.3;
        this.comboDigits.scale.set(startScale);
        const fn = () => {
            t += this.app.ticker.deltaMS;
            const p = Math.min(1, t / dur);
            const s = startScale - (startScale - 1) * p;
            this.comboDigits.scale.set(s);
            if (p >= 1) {
                this.app.ticker.remove(fn);
                this.comboBounceTick = null;
            }
        };
        this.comboBounceTick = fn;
        this.app.ticker.add(fn);
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
        
        const offsetSec = currentTime - target.time; // + late, - early
        const m = offsetSec * 1000;
        let judge = 'MISS';
        if (m >= -50 && m <= 50) {
            judge = 'COOL';
        } else if ((m >= 51 && m <= 85) || (m >= -85 && m <= -51)) {
            judge = 'GOOD';
        } else if ((m >= 86 && m <= 108) || (m >= -108 && m <= -86)) {
            judge = 'BAD';
        } else if (m > 108) {
            judge = 'MISS';
        } else {
            judge = 'MISS';
        }
        
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
        } else {
            this.triggerMiss(target);
        }
    }
    
    triggerHit(judge, lane) {
        if (judge === 'BAD') {
            this.stats.combo = 0;
            this.stats.comboBonus = 0;
        } else {
            this.stats.combo++;
            if (this.stats.combo > this.stats.maxCombo) this.stats.maxCombo = this.stats.combo;
            if (this.stats.combo > 0 && this.stats.combo % 25 === 0) this.stats.comboBonus += 10;
        }
        
        const bonus = (judge === 'COOL' || judge === 'GOOD') ? this.stats.comboBonus : 0;
        if (judge === 'COOL') this.stats.score += 100 + bonus;
        if (judge === 'GOOD') this.stats.score += 80 + bonus;
        if (judge === 'BAD') this.stats.score += 10;
        if (judge === 'COOL') this.stats.cool++;
        else if (judge === 'GOOD') this.stats.good++;
        else if (judge === 'BAD') this.stats.bad++;
        if (judge === 'COOL') this.stats.hp += 2;
        else if (judge === 'GOOD') this.stats.hp += 1.5;
        else if (judge === 'BAD') {/* no hp change */}
        this.stats.hp = Math.max(0, Math.min(100, this.stats.hp));
        if (this.stats.hp <= 0) {
            const failTitle = document.getElementById('fail-title');
            if (failTitle) failTitle.style.opacity = 1;
            const btnExit = document.getElementById('btn-exit');
            if (btnExit) btnExit.click();
            return;
        }
        if (this.stats.score < 0) this.stats.score = 0;
        
        this.updateHUD();
        if (judge !== 'BAD') this.bounceCombo();
        this.showJudgeText(lane, judge);
        this.showHitEffect(lane, judge);
    }
    
    triggerMiss(note) {
        note.missed = true;
        this.stats.combo = 0;
        this.stats.miss++;
        this.stats.comboBonus = 0;
        this.stats.score -= 20;
        this.stats.hp -= 4;
        this.stats.hp = Math.max(0, Math.min(100, this.stats.hp));
        if (this.stats.hp <= 0) {
            const failTitle = document.getElementById('fail-title');
            if (failTitle) failTitle.style.opacity = 1;
            const btnExit = document.getElementById('btn-exit');
            if (btnExit) btnExit.click();
            return;
        }
        if (this.stats.score < 0) this.stats.score = 0;
        this.updateHUD();
        this.showJudgeText(note.lane, 'MISS');
    }
    
    updateHUD() {
        const hudScore = document.getElementById('hud-score');
        const hudCombo = document.getElementById('hud-combo');
        const hudComboBox = document.getElementById('hud-combo-box');
        const hudHealthFill = document.getElementById('hud-health-fill');
        
        if(hudScore) hudScore.textContent = this.stats.score.toString().padStart(8, '0');
        if(hudHealthFill) {
            const h = Math.max(0, Math.min(100, this.stats.hp ?? 100));
            hudHealthFill.style.height = `${h}%`;
        }
        if(hudCombo) { hudCombo.textContent = this.stats.combo; hudCombo.style.display = 'none'; }
        
        // Acc calculation could be better but simple version:
        const total = this.stats.combo + this.stats.miss; // Only processed notes
        // This is wrong, combo resets. We need total hits.
        // But for now it's fine.
        
        // Update Combo Digits
        this.updateComboDigits();
        if (this.comboSprite) {
            this.comboSprite.visible = (this.stats.combo > 0);
        }
    }
    
    showHitEffect(lane, judge) {
        const x = this.startX + (this.laneColumn[lane] ?? lane) * this.LANE_WIDTH + this.LANE_WIDTH/2;
        const y = this.HIT_Y; // Sync with Judge Line
        
        if (this.assetsLoaded && this.textures.flares && this.textures.flares.length > 0) {
            const spr = new PIXI.Sprite(this.textures.flares[0]);
            spr.anchor.set(0.5, 0.5); // Center anchor
            spr.position.set(x, y);   // Position at lane center and judge line
            spr.width = 240;          // Fixed size
            spr.height = 240;
            spr.blendMode = PIXI.BLEND_MODES.ADD;
            this.effectsLayer.addChild(spr);
            let idx = 0;
            let acc = 0;
            const step = () => {
                acc += this.app.ticker.deltaMS;
                if (acc >= 20) {
                    acc -= 20;
                    idx++;
                    if (idx >= this.textures.flares.length) {
                        this.effectsLayer.removeChild(spr);
                        spr.destroy();
                        this.app.ticker.remove(step);
                    } else {
                        spr.texture = this.textures.flares[idx];
                    }
                }
            };
            this.app.ticker.add(step);
        } else {
            // Fallback Graphics
            const circle = new PIXI.Graphics();
            const color = judge === 'COOL' ? 0x00FFFF : (judge === 'GOOD' ? 0x00FF00 : (judge === 'BAD' ? 0xFFA500 : 0x808080));
            circle.beginFill(color, 0.6);
            circle.drawCircle(0, 0, 80);
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

    showJudgeText(lane, judge) {
        // Use Sprite for Image Judgment
        const tex = this.textures.judgments ? this.textures.judgments[judge.toLowerCase()] : null;
        
        if (tex) {
            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5, 0.5);
            sprite.position.set(this.width / 2, this.HIT_Y - 100);
            sprite.scale.set(1.6); // Initial scale (doubled from 0.8)
            sprite.alpha = 0;
            
            this.effectsLayer.addChild(sprite);
            
            // Animation
            let t = 0;
            const animate = () => {
                t += 0.05;
                if (t < 0.2) {
                    // Fade in and scale up
                    sprite.alpha = t * 5;
                    sprite.scale.set(1.6 + t * 2); // Animate from 1.6 to 2.0
                } else if (t < 0.8) {
                    // Hold
                    sprite.alpha = 1;
                    sprite.scale.set(2.0); // Hold at 2.0 (doubled from 1.0)
                } else {
                    // Fade out
                    sprite.alpha = 1 - (t - 0.8) * 2;
                }
                
                if (t >= 1.3) {
                    this.app.ticker.remove(animate);
                    sprite.destroy();
                }
            };
            this.app.ticker.add(animate);
            
        } else {
            // Fallback text
            const style = {
                fontFamily: 'Arial',
                fontSize: 36,
                fontWeight: 'bold',
                fill: '#ffffff',
                stroke: '#000000',
                strokeThickness: 4,
                dropShadow: true,
                dropShadowBlur: 4,
                dropShadowDistance: 2,
            };
            
            if (judge === 'COOL') style.fill = '#00ffff';
            else if (judge === 'GOOD') style.fill = '#00ff00';
            else if (judge === 'BAD') style.fill = '#ffaa00';
            else if (judge === 'MISS') style.fill = '#ff0000';
            
            const text = new PIXI.Text(judge, style);
            text.anchor.set(0.5, 0.5);
            text.position.set(this.width / 2, this.HIT_Y - 100);
            
            this.effectsLayer.addChild(text);
            
            // Simple tween
            let t = 0;
            const animate = () => {
                t += 0.02;
                text.position.y -= 0.5;
                text.alpha = 1 - t;
                if (text.alpha <= 0) {
                    this.app.ticker.remove(animate);
                    text.destroy();
                }
            };
            this.app.ticker.add(animate);
        }
    }

    stop() {
        if (this.audioSource) {
            try { this.audioSource.stop(); } catch(e) {}
            this.audioSource = null;
        }
        if (this.audioContext && this.audioContext.state !== 'suspended') {
            try { this.audioContext.suspend(); } catch(e) {}
        }
        this.isPlaying = false;
        this.app.ticker.remove(this.update, this);
        if (this.notesLayer) this.notesLayer.removeChildren();
        if (this.effectsLayer) this.effectsLayer.removeChildren();
        this.heldLanes = [false, false, false, false];
        if (this.keyBeams) this.keyBeams.forEach(b => { if (b) b.visible = false; });
        this.stats = { combo: 0, score: 0, cool: 0, good: 0, bad: 0, miss: 0, maxCombo: 0, comboBonus: 0, hp: 100 };
        if (this.comboDigits) {
            this.comboDigits.visible = false;
            this.comboDigits.removeChildren();
            this.comboDigits.scale.set(1);
        }
        if (this.comboSprite) this.comboSprite.visible = false;
        if (this.comboBounceTick) { this.app.ticker.remove(this.comboBounceTick); this.comboBounceTick = null; }
        const failTitle = document.getElementById('fail-title');
        if (failTitle) failTitle.style.opacity = 0;
        this.updateHUD();
    }
}
