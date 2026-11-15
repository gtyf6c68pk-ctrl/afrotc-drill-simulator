// =====================================================================
//  voice.js: spoken commands (Phase III). Two engines (Settings → Voice engine):
//   - Offline (Vosk, default): see voice-vosk.js. Exact word timing, drill words only, private.
//   - Chrome (online, below): Chrome's speech recognition; audio goes to Google.
//  This file has the Start/Stop button logic and the Chrome engine.
//  Click "Start voice", allow the microphone, and say commands such as
//  "Forward, HARCH". Each recognized command goes to the open map's flight,
//  just like a typed one.
//
//  Speed: Chrome gives quick first guesses while you speak, then a final answer about a
//  second later. As soon as a first guess is exactly a whole command, it is carried out.
//  Timing: we note the moment the command's last word (HARCH, HALT, COVER, ...) is FIRST
//  heard and subtract the "voice delay" setting. The flight judges the foot timing, and
//  counts its "one more step", from that earlier moment.
//
//  Privacy note: Chrome sends the audio to Google's servers to turn it into text.
// =====================================================================

// Last words of commands: hearing one of these marks "the moment the command was given"
// (checked after clean-up, so misheard words like 'heart' have already become 'harch')
const VOICE_END_WORDS = ['harch', 'hace', 'halt', 'cover', 'hut', 'right', 'left'];

const voice = {
  recognizer: null,
  listening: false,
  lastWordAt: {},   // result number -> time (ms) the last end word was first heard
  handled: {},      // result numbers already acted on from a first guess

  supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); },

  toggle() {
    if (this.listening) this.stop(); else this.start();
  },

  start() {
    if (settings.voiceEngine === 'vosk') { voskEngine.start(); return; }
    if (!this.supported()) {
      this.status('Voice needs Google Chrome (this browser has no speech recognition).', 'bad');
      return;
    }
    if (!this.recognizer) this.setup();
    this.listening = true;
    try { this.recognizer.start(); } catch (e) { /* already running */ }
    document.getElementById('voiceBtn').textContent = '■ Stop voice';
    this.status('🎤 Listening… say a command.', 'good');
  },

  stop() {
    if (settings.voiceEngine === 'vosk') { voskEngine.stop(); return; }
    this.listening = false;
    if (this.recognizer) this.recognizer.stop();
    document.getElementById('voiceBtn').textContent = '🎤 Start voice';
    this.status('Voice is off.', '');
  },

  setup() {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new R();
    r.lang = 'en-US';
    r.continuous = true;        // keep listening between commands
    r.interimResults = true;    // get words as they are heard (for timing)
    r.maxAlternatives = 3;      // a few guesses; we pick the one that is a real command

    r.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        const key = cleanUpCommand(text, true);
        if (VOICE_END_WORDS.includes(key.split(' ').pop()) && !(i in this.lastWordAt)) this.lastWordAt[i] = performance.now();

        if (!result.isFinal) {
          // FAST PATH: act on the first guess as soon as it is exactly a whole command,
          // instead of waiting about a second for Chrome's final answer.
          if (!this.handled[i] && COMMANDS_BY_KEY[key] && (i in this.lastWordAt)) {
            this.handled[i] = true;
            this.send(text, i);
          } else if (!this.handled[i]) {
            this.status('🎤 Hearing: “' + text + '”', 'good');
          }
          continue;
        }
        if (this.handled[i]) { delete this.handled[i]; delete this.lastWordAt[i]; continue; }   // already done

        // Final answer: choose the guess that matches a command, if any
        let best = result[0].transcript;
        for (let a = 0; a < result.length; a++) {
          if (COMMANDS_BY_KEY[cleanUpCommand(result[a].transcript, true)]) { best = result[a].transcript; break; }
        }
        this.send(best, i);
        delete this.lastWordAt[i];
      }
    };

    r.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;   // just quiet
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.status('Chrome blocked the microphone. Start the game with "Start Drill Simulator.command" and click Allow.', 'bad');
      } else if (event.error === 'network') {
        this.status('Voice needs an internet connection (Chrome sends the audio to Google to recognize it).', 'bad');
      } else if (event.error === 'audio-capture') {
        this.status('No microphone found. Plug one in or check your Mac\'s sound settings.', 'bad');
      } else {
        this.status('Voice error: ' + event.error, 'bad');
      }
      this.listening = false;
      document.getElementById('voiceBtn').textContent = '🎤 Start voice';
    };

    // Chrome stops listening after a while; start again if voice is still switched on
    r.onend = () => {
      this.handled = {}; this.lastWordAt = {};   // a new session numbers its results from 0 again
      if (this.listening) { try { r.start(); } catch (e) { /* ignore */ } }
    };
    this.recognizer = r;
  },

  // Give the command to the flight, saying how long ago it was really spoken
  send(text, i) {
    const heardAt = (i in this.lastWordAt) ? this.lastWordAt[i] : performance.now();
    const ageSeconds = (performance.now() - heardAt) / 1000 + settings.voiceDelay;
    this.status('🎤 Heard: “' + text.trim() + '”', 'good');
    if (activeFlight) activeFlight.giveCommand(text, { voice: true, ageSeconds });
    else this.status('🎤 Heard: “' + text.trim() + '”. Open the Drill Pad or Campus first.', 'warn');
  },

  status(message, kind) {
    const el = document.getElementById('voiceStatus');
    el.textContent = message;
    el.className = kind || '';
  },
};
