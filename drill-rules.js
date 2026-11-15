// =====================================================================
//  drill-rules.js: ALL drill commands and rules in one place (data only).
//  To add a command: add an entry to DRILL.commands. The command list on the
//  page is built from this file automatically. If the command needs a brand-new
//  kind of movement, add its `action` to FlightLogic.runAction (flight-logic.js).
//  Source: DAFPAM 34-1203 + the command inflection chart (IMG_1111.JPG).
// =====================================================================

const DRILL = {
  // ---------- Measurements (game units: 20 units = one 24-inch step) ----------
  measurements: {
    stepPx: 20,            // one 24-inch marching step
    distancePx: 33,        // 40-inch distance, front to back
    intervalPx: 36,        // normal interval (arm's length), side to side
    closeIntervalPx: 16,   // close interval: 24 inches narrower than normal (4.10.1: two 12-inch right steps per element)
    rightStepPx: 10,       // right/left step: 12 inches (3.14)
    cdrOffsetPx: 40,       // how far out from the flight the commander marches
    cdrDepth: 0.75,        // commander marches 3/4 of the way back along the flight
    cdrFrontPaces: 3,      // in line at the halt: 3 paces in front of, centered on, facing the flight
    cdrClearancePx: 20,    // how wide the commander walks around the flight
    walkSpeedPx: 100,      // speed (units/second) when the guide/commander move to a new post
    doubleTimeStepPx: 25,  // double time: 30-inch steps (3.11.2)
    doubleTimeRatio: 1.5,  // double time cadence = 1.5 x quick time (180 vs 120 steps/min)
  },

  // ---------- Disorder and timing ----------
  disorder: {
    maxDriftPx: 10,        // furthest a cadet can drift from their proper spot
    naturalDriftPx: 0.15,  // drift per step while marching, even with good commands
    timingGrace: 0.2,      // within 0.2 of a step of the correct heel strike = on time
    badTimingDriftPx: 8,   // extra drift for a command given a full step off
    sloppyWordDriftPx: 3,  // extra drift per letter wrong in a command
    coverSpeedPx: 15,      // units/second cadets move back into place on COVER
    stairsDriftPx: 6,      // marching onto stairs at attention instead of route step (user's rule)
  },

  // ---------- Road guards (FOUNDATION ONLY: the detachment's procedure is not in DAFPAM
  //            34-1203 and will be added later from the user's SOP) ----------
  // The flight already reports intersections it approaches / crosses / clears
  // (FlightLogic.trackIntersections -> options.onIntersection). When the procedure arrives:
  // add its commands to `commands` above and its rules here.
  roadGuards: {
    enabled: false,
    approachPx: 490,       // "approaching" = the guide is within 15 m of an intersection, heading toward it
    commands: [],          // e.g. post / recover commands, from the SOP
  },

  // Cadence counts 1-4 (from the inflection chart). Counts 1 and 3 fall on the left foot (3.10.1).
  cadenceWords: ['HUT', 'TOOP', 'THREEP', 'FOURP'],

  // ---------- How typed/spoken text is cleaned up ----------
  // Syllable breaks from the inflection chart are joined, e.g. "A-bout" -> "about".
  spellings: [
    [/\ba bout\b/g, 'about'],
    [/\bfor ward\b/g, 'forward'],
    [/\btothe\b/g, 'to the'],
    [/\brearp\b/g, 'rear'],
    [/\b(tench hut|tenchut|tenhut|ten hut)\b/g, 'ten hut'],
    [/\b(ah|a|at|uh) ten (chut|hut|shut)\b/g, 'ten hut'],   // "Ah-Ten-CHUT" (user's recording)
    [/\batten (chut|hut)\b/g, 'ten hut'],
    [/\bhalfright\b/g, 'half right'],
    [/\bhalfleft\b/g, 'half left'],
    [/\bninety\b/g, '90'],
    [/\b(forty five|fortyfive)\b/g, '45'],
    [/\bdegree\b/g, 'degrees'],
    [/\b(90|45)degrees\b/g, '$1 degrees'],
  ],
  unitPrefix: /^flight /,   // "Flight, HALT" -> "halt"

  // Extra clean-up for SPOKEN commands only (Phase III). Speech recognition writes real
  // words, so a correct "HARCH" usually comes out as "march"; by voice they're accepted.
  // Typed commands stay strict (see rejectedWords).
  // Words the microphone commonly hears instead (reported by the user) are mapped back.
  // Extra phrases the offline voice engine listens for (besides the commands themselves)
  // "Ah-Ten-CHUT": "chut" isn't an English word, so listen for the nearest real ones (chute, shut).
  voicePhrases: ['at ten hut', 'a ten hut', 'at ten chute', 'a ten chute', 'ten chute', 'at ten shut', 'a ten shut', 'ten shut',
                 'flight at ten hut', 'flight a ten hut', 'flight a ten chute', 'flight at ten chute'],

  voiceSpellings: [
    [/\b(?:(?:ah|a|at|uh) )?ten (chute|chut|shut|shoot|hut)\b/g, 'ten hut'],   // Ah-Ten-CHUT
    [/\b(fight|flite|flights|fright)\b/g, 'flight'],                            // "Flight"
    [/\b(march|heart|hearts|harsh|hard|arch|marsh|hatch|harp|hearth|harsch)\b/g, 'harch'],   // "HARCH"
    [/\b(face|pace|phase|base|haze|faith)\b/g, 'hace'],                        // "HACE"
    [/\b(then|ten|10|tent|tin|tench|than) (shut|hut|hot|hat|but|what)\b/g, 'ten hut'],   // "Ten-HUT"
    [/\b(tension|tenhut|tenshut)\b/g, 'ten hut'],
    [/\b(covered|covert|cuffer)\b/g, 'cover'],
  ],

  // Plain words that are NOT accepted (no bad habits): the command voice must be used.
  rejectedWords: [
    { word: 'march',     fix: 'Use the command voice: HARCH, not MARCH (e.g. Forward, HARCH).' },
    { word: 'face',      fix: 'Use the command voice: HACE, not FACE (e.g. Right, HACE).' },
    { word: 'attention', fix: 'Use the command voice: Flight, Ten-HUT, not ATTENTION.' },
  ],

  // ---------- The commands ----------
  //   key:    what the cleaned-up text must match
  //   say:    how the command is written/said
  //   label:  short name used in messages
  //   foot:   which heel must be striking when it's given while marching
  //           ('left' / 'right' / 'either' / null = no timing)
  //   when:   'halt', 'marching', 'both', or 'afterHalt'
  //   action: which movement it triggers (see FlightLogic.runAction);
  //           `turn` = quarter turns, + right / - left (0.5 = 45 degrees, 1 = 90, 2 = 180)
  //   routeStepOk: true if it may be given at route step / at ease (DAFPAM 3.19)
  //   doubleTimeOk: true if it may be given in double time (DAFPAM 3.11.6)
  //   markTimeOk:   true if it may be given while marking time
  //   note:   extra help text for the command list
  //   ref:    DAFPAM 34-1203 paragraph
  commands: [
    { key: 'forward harch', say: 'Forward, HARCH', label: 'Forward', foot: 'left', when: 'both',
      action: 'forwardMarch', markTimeOk: true, note: 'ends the half step or mark time', ref: '3.10.1, 3.12.3, 3.13.2' },
    { key: 'halt', say: 'Flight, HALT', label: 'Flight, HALT', foot: 'either', when: 'marching',
      action: 'halt', markTimeOk: true, doubleTimeOk: true, sideStepOk: true, note: 'one more step, then the trailing foot comes alongside', ref: '3.10.2, 3.11.5' },
    { key: 'right hace', say: 'Right, HACE', label: 'Right Face', foot: null, when: 'halt',
      action: 'facing', turn: 1, ref: '3.4.1' },
    { key: 'left hace', say: 'Left, HACE', label: 'Left Face', foot: null, when: 'halt',
      action: 'facing', turn: -1, ref: '3.4.1' },
    { key: 'about hace', say: 'A-bout, HACE', label: 'About Face', foot: null, when: 'halt',
      action: 'facing', turn: 2, ref: '3.4.2' },
    { key: 'right flank harch', say: 'Right Flank, HARCH', label: 'Right Flank', foot: 'right', when: 'marching',
      action: 'flank', turn: 1, ref: '3.17' },
    { key: 'left flank harch', say: 'Left Flank, HARCH', label: 'Left Flank', foot: 'left', when: 'marching',
      action: 'flank', turn: -1, ref: '3.17' },
    { key: 'to the rear harch', say: 'To the Rear, HARCH', label: 'To the Rear', foot: 'right', when: 'marching',
      action: 'toTheRear', ref: '3.16' },
    { key: 'column right harch', say: 'Column Right, HARCH', label: 'Column Right', foot: 'right', when: 'both',
      action: 'column', turn: 1, ref: '4.11' },
    { key: 'column left harch', say: 'Column Left, HARCH', label: 'Column Left', foot: 'left', when: 'both',
      action: 'column', turn: -1, ref: '4.11' },
    { key: 'column half right harch', say: 'Column Half Right, HARCH', label: 'Column Half Right', foot: 'right', when: 'both',
      action: 'column', turn: 0.5, note: '45 degrees; full step resumes on its own', ref: '4.12' },
    { key: 'column half left harch', say: 'Column Half Left, HARCH', label: 'Column Half Left', foot: 'left', when: 'both',
      action: 'column', turn: -0.5, note: '45 degrees; full step resumes on its own', ref: '4.12' },
    { key: 'incline to the right', say: 'Incline to the Right', label: 'Incline to the Right', foot: null, when: 'marching',
      action: 'incline', turn: 0.5, routeStepOk: true, doubleTimeOk: true, note: 'slight change of direction (45 degrees), no pivot', ref: '4.12.4, 3.19' },
    { key: 'incline to the left', say: 'Incline to the Left', label: 'Incline to the Left', foot: null, when: 'marching',
      action: 'incline', turn: -0.5, routeStepOk: true, doubleTimeOk: true, note: 'slight change of direction (45 degrees), no pivot', ref: '4.12.4, 3.19' },
    { key: 'guide incline 45 degrees to the right', say: 'Guide, incline 45 degrees to the Right', label: 'Guide, incline 45 degrees to the Right',
      foot: null, when: 'marching', action: 'incline', turn: 0.5, routeStepOk: true, doubleTimeOk: true, ref: '3.19' },
    { key: 'guide incline 45 degrees to the left', say: 'Guide, incline 45 degrees to the Left', label: 'Guide, incline 45 degrees to the Left',
      foot: null, when: 'marching', action: 'incline', turn: -0.5, routeStepOk: true, doubleTimeOk: true, ref: '3.19' },
    { key: 'guide incline 90 degrees to the right', say: 'Guide, incline 90 degrees to the Right', label: 'Guide, incline 90 degrees to the Right',
      foot: null, when: 'marching', action: 'incline', turn: 1, routeStepOk: true, doubleTimeOk: true, ref: '3.19' },
    { key: 'guide incline 90 degrees to the left', say: 'Guide, incline 90 degrees to the Left', label: 'Guide, incline 90 degrees to the Left',
      foot: null, when: 'marching', action: 'incline', turn: -1, routeStepOk: true, doubleTimeOk: true, ref: '3.19' },
    { key: 'half step harch', say: 'Half Step, HARCH', label: 'Half Step', foot: 'either', when: 'marching',
      action: 'halfStep', note: '12-inch steps until Forward, HARCH or HALT; no changes of direction', ref: '3.13' },
    { key: 'mark time harch', say: 'Mark Time, HARCH', label: 'Mark Time', foot: 'either', when: 'both',
      action: 'markTime', note: 'march in place; Forward, HARCH (left foot) to step off', ref: '3.12' },
    { key: 'double time harch', say: 'Double Time, HARCH', label: 'Double Time', foot: 'either', when: 'both',
      action: 'doubleTime', note: '180 steps/min, 30-inch steps; only inclines, Quick Time and HALT allowed', ref: '3.11' },
    { key: 'quick time harch', say: 'Quick Time, HARCH', label: 'Quick Time', foot: 'either', when: 'marching',
      action: 'quickTime', doubleTimeOk: true, note: 'two more double-time steps, then quick time', ref: '3.11.4' },
    { key: 'change step harch', say: 'Change Step, HARCH', label: 'Change Step', foot: 'right', when: 'marching',
      action: 'changeStep', ref: '3.15' },
    { key: 'counter harch', say: 'Counter, HARCH', label: 'Counter, HARCH', foot: 'left', when: 'both',
      action: 'counterMarch', ref: '4.16' },
    { key: 'route step harch', say: 'Route Step, HARCH', label: 'Route Step', foot: 'either', when: 'marching',
      action: 'routeStep', variant: 'ROUTE STEP', note: 'out of step; talking allowed', ref: '3.19.1' },
    { key: 'at ease harch', say: 'At Ease, HARCH', label: 'At Ease', foot: 'either', when: 'marching',
      action: 'routeStep', variant: 'AT EASE', note: 'out of step; silence', ref: '3.19.2' },
    { key: 'ten hut', say: 'Flight, Ten-HUT', label: 'Flight, Ten-HUT', foot: null, when: 'marching',
      action: 'attention', routeStepOk: true, note: 'back to attention from route step or at ease', ref: '3.19' },
    { key: 'close harch', say: 'Close, HARCH', label: 'Close, HARCH', foot: 'right', when: 'both',
      action: 'interval', close: true, note: 'close interval; the right element stands fast (at the halt) or half steps (marching)', ref: '4.10' },
    { key: 'extend harch', say: 'Extend, HARCH', label: 'Extend, HARCH', foot: 'left', when: 'both',
      action: 'interval', close: false, note: 'back to normal interval', ref: '4.10' },
    { key: 'guide right', say: 'GUIDE RIGHT', label: 'GUIDE RIGHT', foot: null, when: 'both',
      action: 'troopWalkEdge', note: "on a sidewalk: the flight slides over until the guide's file is along the right edge",
      ref: 'detachment procedure (troop walk)' },
    { key: 'right step harch', say: 'Right Step, HARCH', label: 'Right Step', foot: null, when: 'halt',
      action: 'sideStep', turn: 1, note: '12-inch steps to the right until Flight, HALT', ref: '3.14' },
    { key: 'left step harch', say: 'Left Step, HARCH', label: 'Left Step', foot: null, when: 'halt',
      action: 'sideStep', turn: -1, note: '12-inch steps to the left until Flight, HALT', ref: '3.14' },
    { key: 'cover', say: 'COVER', label: 'COVER', foot: null, when: 'afterHalt',
      action: 'cover', note: 'straightens the flight out; required after every halt', ref: '4.4.2' },
  ],
};
