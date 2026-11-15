// =====================================================================
//  voice-vosk.js: OFFLINE voice engine (Vosk, runs on this computer, no internet,
//  no audio sent anywhere). Library: assets/vosk/vosk.js (vosk-browser, Apache-2.0).
//  Model: assets/vosk/vosk-model-small-en-us-0.15.tar.gz (Apache-2.0).
//
//  How it works:
//   - The recognizer is limited to drill words (a "grammar" built from drill-rules.js),
//     so it can't hear "fight" or "pace".
//   - SPEED: while you talk it gives quick partial guesses. As soon as a guess is exactly a
//     whole command, the flight carries it out (timing estimated with the voice delay setting).
//   - ACCURACY: when you pause, it gives a final result with the exact time each word
//     STARTED. The foot timing is then graded on the moment you began saying HARCH/HALT/...,
//     and the "one more step" is moved onto the correct step if it hasn't happened yet.
//   - Commands with a pause between the two parts ("Right Flank ... HARCH") may arrive as
//     two pieces; the first piece is held for a few seconds and joined to the second.
//  Needs the game to be started with "Start Drill Simulator.command" (http://localhost).
// =====================================================================

const VOSK_MODEL_URL = 'assets/vosk/vosk-model-small-en-us-0.15.tar.gz';
const VOSK_END_WORDS = ['harch', 'hace', 'halt', 'cover', 'hut', 'right', 'left', 'hest', 'harms'];   // after clean-up
const VOSK_HOLD_SECONDS = 4;   // how long a preparatory command waits for its command of execution

// The phrases the recognizer may hear, made from drill-rules.js. HARCH/HACE aren't English
// words, so the recognizer listens for "march"/"face" (accepted by voice, as decided).
function voskGrammar() {
  const spoken = key => key.replace(/\bharch\b/g, 'march').replace(/\bhace\b/g, 'face')
    .replace(/\bharms\b/g, 'arms').replace(/\bhest\b/g, 'rest')
    .replace(/\b45\b/g, 'forty five').replace(/\b90\b/g, 'ninety');
  const phrases = new Set();
  DRILL.commands.forEach(c => {
    const whole = spoken(c.key);
    phrases.add(whole);
    phrases.add('flight ' + whole);                       // unit designator in front
    const words = whole.split(' ');
    if (words.length > 1) {                               // the two parts said separately
      phrases.add(words.slice(0, -1).join(' '));
      phrases.add('flight ' + words.slice(0, -1).join(' '));
      phrases.add(words[words.length - 1]);
    }
  });
  phrases.add('flight');
  (DRILL.voicePhrases || []).forEach(p => phrases.add(p));   // e.g. "at ten hut" (Ah-Ten-CHUT)
  if (typeof REPORT_PHRASES !== 'undefined') REPORT_PHRASES.forEach(p => phrases.add(p));   // FDE report in / out
  phrases.add('[unk]');                                   // anything else
  return [...phrases];
}

const voskEngine = {
  model: null, recognizer: null, audio: null, node: null, stream: null,
  audioStartMs: null,   // performance.now() at the start of the audio stream
  carry: null,          // held preparatory words { words: [...], until }
  consumed: 0,          // words of the current utterance already used for a command
  executed: [],         // commands carried out from partial guesses in this utterance

  async start() {
    if (location.protocol === 'file:') {
      voice.status('The offline voice engine needs the launcher: double-click "Start Drill Simulator.command".', 'bad');
      voice.listening = false;
      return;
    }
    voice.listening = true;
    document.getElementById('voiceBtn').textContent = '■ Stop voice';
    try {
      if (!this.model) {
        voice.status('Loading the offline voice model (about 10 seconds the first time)…', 'warn');
        await loadScriptOnce('assets/vosk/vosk.js');
        this.model = await Vosk.createModel(new URL(VOSK_MODEL_URL, location.href).href);
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false, audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      this.audio = new AudioContext();
      this.recognizer = new this.model.KaldiRecognizer(this.audio.sampleRate, JSON.stringify(voskGrammar()));
      this.recognizer.setWords(true);
      this.recognizer.on('partialresult', m => this.onPartial(m.result.partial || ''));
      this.recognizer.on('result', m => this.onResult(m.result || {}));

      this.node = this.audio.createScriptProcessor(2048, 1, 1);
      this.audioStartMs = null;
      this.node.onaudioprocess = e => {
        if (this.audioStartMs === null) this.audioStartMs = performance.now() - e.inputBuffer.duration * 1000;
        try { this.recognizer.acceptWaveform(e.inputBuffer); } catch (err) { /* ignore one bad chunk */ }
      };
      this.audio.createMediaStreamSource(this.stream).connect(this.node);
      this.node.connect(this.audio.destination);   // (silent) keeps the audio flowing
      this.carry = null; this.consumed = 0; this.executed = [];
      voice.status('🎤 Listening (offline)… say a command.', 'good');
    } catch (err) {
      const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      voice.status(blocked ? 'The microphone is blocked. Click the camera/microphone icon in Chrome\'s address bar and allow it.'
                           : 'Voice error: ' + (err && err.message ? err.message : err), 'bad');
      this.stop(true);
    }
  },

  stop(keepMessage) {
    voice.listening = false;
    document.getElementById('voiceBtn').textContent = '🎤 Start voice';
    if (this.node) { this.node.disconnect(); this.node.onaudioprocess = null; this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.audio) { this.audio.close(); this.audio = null; }
    if (this.recognizer) { this.recognizer.remove(); this.recognizer = null; }
    if (!keepMessage) voice.status('Voice is off.', '');
  },

  // Words from recognizer text, without the "[unk]" (unknown) marker
  words(text) { return text.toLowerCase().split(/\s+/).filter(w => w && w !== '[unk]'); },

  // The words held from an earlier piece (if still fresh) plus these
  withCarry(words) {
    if (this.carry && performance.now() > this.carry.until) this.carry = null;
    return (this.carry ? this.carry.words : []).concat(words);
  },

  isCommandStart(words) {
    const start = cleanUpCommand(words.join(' '), true);
    return !!start && (isPreparatoryOnly(start) || DRILL.commands.some(c => c.key.startsWith(start + ' ')));
  },

  // Quick guess while still speaking: carry out a command the moment it is complete
  onPartial(text) {
    const all = this.withCarry(this.words(text));
    const rest = all.slice(this.consumed);
    if (!rest.length) return;
    const key = cleanUpCommand(rest.join(' '), true);
    if (COMMANDS_BY_KEY[key] && VOSK_END_WORDS.includes(key.split(' ').pop())) {
      const handle = this.give(rest.join(' '), { voice: true, ageSeconds: settings.voiceDelay, deferTiming: true });
      this.executed.push({ count: rest.length, handle, givenAt: performance.now() });
      this.consumed += rest.length;
    } else {
      voice.status('🎤 Hearing: “' + all.join(' ') + '”', 'good');
    }
  },

  // Final result (after a pause), with the exact start time of every word
  onResult(result) {
    const timed = (result.result || []).filter(w => w.word !== '[unk]');
    const carried = this.carry && performance.now() <= this.carry.until
      ? this.carry.words.map((word, i) => ({ word, ms: this.carry.times ? this.carry.times[i] : null })) : [];
    const all = carried.concat(timed);
    const toMs = w => !w ? null : w.ms !== undefined ? w.ms
                    : (w.start !== undefined && this.audioStartMs !== null) ? this.audioStartMs + w.start * 1000 : null;
    // The last word of the PREPARATORY command of the command in all[from .. to-1] (graded by DAFPAM 3.9.2)
    const prepMs = (from, to) => {
      const n = execWordCount(all.slice(from, to).map(w => w.word));
      return to - 1 - n >= from ? toMs(all[to - 1 - n]) : null;
    };
    let pos = 0, note = '';
    // Start fresh for the next utterance FIRST, so nothing below can leave stale notes behind
    const executed = this.executed;
    this.executed = [];
    this.consumed = 0;
    this.carry = null;

    // 1. Grade the commands already carried out, using the exact time of their last word
    executed.forEach(e => {
      const last = all[pos + e.count - 1];
      const saidAt = toMs(last);
      if (saidAt !== null && activeFlight) {
        const prepAt = prepMs(pos, pos + e.count);
        activeFlight.judgeTiming(e.handle, (e.givenAt - saidAt) / 1000, prepAt !== null ? (e.givenAt - prepAt) / 1000 : null);
        note = ' (HARCH/HALT started ' + ((e.givenAt - saidAt) / 1000).toFixed(2) + ' s before the flight reacted)';
      }
      pos += e.count;
    });

    // 2. Anything left over: a whole command (carry it out now, timing exact),
    //    the first part of a command (hold it), or something unknown
    const rest = all.slice(pos);
    if (rest.length) {
      const text = rest.map(w => w.word).join(' ');
      const key = cleanUpCommand(text, true);
      const saidAt = toMs(rest[rest.length - 1]);
      if (COMMANDS_BY_KEY[key]) {
        const prepAt = prepMs(pos, all.length);
        this.give(text, { voice: true, ageSeconds: saidAt !== null ? (performance.now() - saidAt) / 1000 : settings.voiceDelay,
                          prepAgeSeconds: prepAt !== null ? (performance.now() - prepAt) / 1000 : null });
      } else if (this.isCommandStart(rest.map(w => w.word))) {
        this.carry = { words: rest.map(w => w.word), times: rest.map(toMs), until: performance.now() + VOSK_HOLD_SECONDS * 1000 };
        voice.status('🎤 Heard: “' + text + '” … waiting for the command of execution', 'good');
      } else if (activeFlight) {
        routeCommand(text, { voice: true });   // a report to the evaluator, or "not a command I know"
      }
    } else if (note && this.lastHeard) {
      voice.status('🎤 Heard: “' + this.lastHeard + '”' + note, 'good');
    }
  },

  give(text, options) {
    this.lastHeard = text;
    voice.status('🎤 Heard: “' + text + '”', 'good');
    if (!activeFlight) { voice.status('🎤 Heard: “' + text + '”. Open the Drill Pad or Campus first.', 'warn'); return null; }
    return routeCommand(text, options);
  },
};

// How many of the last words are the command of execution ("harch" = 1, "a ten shut" = 3 ...)
function execWordCount(words) {
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const c = cleanUpCommand(words.slice(-n).join(' '), true);
    if (c === 'ten hut' || (n === 1 && DRILL.executionWords.includes(c))) return n;
  }
  return 1;
}

// Load a script file only when it's first needed (the offline engine is large)
function loadScriptOnce(src) {
  if (document.querySelector('script[data-src="' + src + '"]')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}
