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

  // ---------- Preparatory command and command of execution (Phase 6 grading) ----------
  // DAFPAM 2.2.7 / 3.9.2: for a flight, the preparatory command is given as the heel of the foot
  // in the direction of the movement strikes the ground, and the command of execution when that
  // SAME heel next strikes: two steps later ("one step between", 2.4.1). The point of emphasis is
  // the LAST word of the preparatory command (2.4.2: in Right Flank, "Flank" on the right foot).
  // 2.4.1 allows a longer interval, so a gap of 4, 6... steps on the same foot is also correct.
  // At route step / at ease, both parts must be on the same foot (3.19).
  preparatory: {
    gapSteps: 2,           // execution comes this many steps after the preparatory command
    minGapSteps: 1.5,      // closer than this = the two parts run together
    holdSeconds: 4,        // a typed/spoken preparatory command waits this long for its execution word
    unitWord: 'flight',    // "Flight" is the preparatory command of Flight, HALT / Flight, Ten-HUT (2.1.1.1)
  },
  // The command of execution: the last word(s) of every command
  executionWords: ['harch', 'hace', 'halt', 'cover', 'ten hut', 'right', 'left', 'hest', 'harms', 'out', 'in'],

  // ---------- Road guards (user's detachment SOP, 2026-11-14; AFROTCI 36-2011 Vol 1 p. 25) ----------
  //  1. Halt the flight before the intersection.  2. Road Guards, OUT: the flight commander marches to
  //  the middle of the intersection and the road guards run out to guard each side, at parade rest
  //  with the right hand extended (high-visibility belts).  3. March the flight through.
  //  4. Once the flight has passed: Road Guards, IN: the guards run back to their places in the flight
  //  and the commander returns to post.  Required for flights larger than 8 (Vol 1); with 7 or fewer
  //  the flight commander acts as road guard.
  roadGuards: {
    enabled: true,
    approachPx: 490,       // "approaching" = the guide within 15 m of an intersection, heading toward it
    count: 2,              // usually 2-3 road guards (user); 3 when the flight has 4 elements
    from: 'last rank, outside files (+ middle file for a third guard)',   // proposed default (user: "propose in Phase 11")
    requiredAbove: 8,      // flights larger than 8 need road guards (Vol 1)
    runSpeedPx: 85,        // road guards run (~2.6 m/s)
    postPastEdgePx: 20,    // guards stand this far inside the road from the intersection's edge
    allowedWhileOut: ['forwardMarch', 'halt', 'markTime', 'halfStep', 'quickTime', 'changeStep', 'cover', 'roadGuards', 'attention', 'incline'],
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
    [/\bparade (rest|hest)\b/g, 'parade hest'],   // Parade, REST (DAFPAM) / Parade, HEST (user's inflection)
    [/\bpre sent\b/g, 'present'],                  // "Pre-sent, HARMS" (chart)
    [/\bor der\b/g, 'order'],                      // "Or-der, HARMS" (chart)
    [/\broad ?guard (out|in)\b/g, 'road guards $1'],
    [/\broadguards\b/g, 'road guards'],
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
    [/\b(arms|alarms|charms|farms|harm|arm|arts|alms)\b/g, 'harms'],          // "HARMS"
    [/\bparade (best|test|chest|vest|west|nest)\b/g, 'parade hest'],         // "Parade, HEST"
  ],

  // Plain words that are NOT accepted (no bad habits): the command voice must be used.
  rejectedWords: [
    { word: 'march',     fix: 'Use the command voice: HARCH, not MARCH (e.g. Forward, HARCH).' },
    { word: 'face',      fix: 'Use the command voice: HACE, not FACE (e.g. Right, HACE).' },
    { word: 'attention', fix: 'Use the command voice: Flight, Ten-HUT, not ATTENTION.' },
    { word: 'arms',      fix: 'Use the command voice: HARMS, not ARMS (e.g. Pre-sent, HARMS).' },
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
  //   notInvertedColumn: true if it can't be given while the flight is in INVERTED column
  //           (column movements are made from column, DAFPAM 4.11; user's rule, 2026-11-15)
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
    // To the Rear from the HALT: the flight faces about and steps off (user's detachment practice,
    // 2026-11-15; DAFPAM 3.16 only describes it while marching).
    { key: 'to the rear harch', say: 'To the Rear, HARCH', label: 'To the Rear', foot: 'right', when: 'both',
      action: 'toTheRear', note: 'from the halt the flight faces about and steps off', ref: '3.16' },
    { key: 'column right harch', say: 'Column Right, HARCH', label: 'Column Right', foot: 'right', when: 'both',
      action: 'column', turn: 1, notInvertedColumn: true, ref: '4.11' },
    { key: 'column left harch', say: 'Column Left, HARCH', label: 'Column Left', foot: 'left', when: 'both',
      action: 'column', turn: -1, notInvertedColumn: true, ref: '4.11' },
    { key: 'column half right harch', say: 'Column Half Right, HARCH', label: 'Column Half Right', foot: 'right', when: 'both',
      action: 'column', turn: 0.5, note: '45 degrees; full step resumes on its own', notInvertedColumn: true, ref: '4.12' },
    { key: 'column half left harch', say: 'Column Half Left, HARCH', label: 'Column Half Left', foot: 'left', when: 'both',
      action: 'column', turn: -0.5, note: '45 degrees; full step resumes on its own', notInvertedColumn: true, ref: '4.12' },
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
    { key: 'ten hut', say: 'Flight, Ten-HUT', label: 'Flight, Ten-HUT', foot: null, when: 'both',
      action: 'attention', routeStepOk: true, note: 'back to attention from parade rest (halt) or from route step / at ease (marching)', ref: '3.3.2, 3.19' },
    // ---------- At-the-halt positions needed for the FDE (Phase 7; FDE scorecard, DAFPAM Atch 7) ----------
    // "Parade, HEST": the user's recorded inflection (DAFPAM 3.3.1.1 writes Parade, REST; both are accepted typed).
    { key: 'parade hest', say: 'Parade, HEST', label: 'Parade Rest', foot: null, when: 'halt',
      action: 'paradeRest', note: 'only from attention at the halt; Flight, Ten-HUT to return to attention', ref: '3.3.1.1' },
    { key: 'present harms', say: 'Pre-sent, HARMS', label: 'Present Arms', foot: null, when: 'halt',
      action: 'presentArms', note: 'first count of the hand salute; nothing else until Order, HARMS', ref: '3.7' },
    { key: 'order harms', say: 'Or-der, HARMS', label: 'Order Arms', foot: null, when: 'halt',
      action: 'orderArms', note: 'second count of the hand salute (after Present, HARMS)', ref: '3.7' },
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
    { key: 'road guards out', say: 'Road Guards, OUT', label: 'Road Guards, OUT', foot: null, when: 'halt',
      action: 'roadGuards', out: true, note: 'at the halt before an intersection: guards post on each side, the commander goes to the middle',
      ref: 'detachment SOP; AFROTCI 36-2011 Vol 1' },
    { key: 'road guards in', say: 'Road Guards, IN', label: 'Road Guards, IN', foot: null, when: 'both',
      action: 'roadGuards', out: false, note: 'once the whole flight has passed the intersection: guards return, commander back to post',
      ref: 'detachment SOP; AFROTCI 36-2011 Vol 1' },
    { key: 'cover', say: 'COVER', label: 'COVER', foot: null, when: 'afterHalt',
      action: 'cover', note: 'straightens the flight out; required after every halt', ref: '4.4.2' },
  ],
};
