// =====================================================================
//  courtesy-rules.js: MILITARY COURTESY rules for Live mode (DATA ONLY; Phase 10).
//
//  ⚠ PLACEHOLDERS: the detachment's customs & courtesies rules have NOT arrived yet (CLAUDE.md,
//  "Waiting on the user"). Everything marked PLACEHOLDER below is a stand-in to be confirmed or
//  replaced by the user. Only the salute rules marked "DAFPAM" come from DAFPAM 34-1203 (3.6).
//  Edit this file and reload: the game, its grading and the voice phrases all read it.
// =====================================================================

const COURTESY = {
  confirmed: false,          // set to true once the detachment's rules are entered here

  // Who must be saluted (outdoors, in uniform)
  //  DAFPAM 3.6.1: salutes are exchanged outdoors upon recognition between officers and cadets;
  //                the junior member salutes first, in time for the officer to return it.
  //  DAFPAM 3.6.3: in formation only the person in charge (the flight commander) salutes, for the
  //                whole formation; the members don't salute unless commanded.
  //  DAFPAM 3.6.7: civilians MAY be saluted (not required).
  salute: {
    cadre: true,             // DAFPAM 3.6.1 (officers)
    poc: false,              // PLACEHOLDER: do cadets salute POC cadet officers in your detachment? (not required here yet)
    civilian: false,         // DAFPAM 3.6.7: may, not must
  },

  // Distance at which a person is "recognized" and must be saluted/greeted, in meters.
  // DAFPAM 3.6.1: no exact distance ("good judgment"). PLACEHOLDER numbers:
  recognitionMeters: 15,     // greet / salute once they are this close (and still in front or beside you)
  passedMeters: 18,          // once they are this far away again, the chance has passed (missed if not done)

  // Greeting of the day by the computer's clock. PLACEHOLDER cutoffs (24 h clock):
  timeOfDay: [
    { before: 12, word: 'morning' },
    { before: 17, word: 'afternoon' },
    { before: 24, word: 'evening' },
  ],

  // What to say to each kind of person. PLACEHOLDER wording (ask the detachment).
  //   {tod} = morning / afternoon / evening, {sirmaam} = sir / ma'am,
  //   {address} = the person's form of address + last name (e.g. "Cadet Colonel Reed", "Captain Moore")
  // Any of the listed forms is accepted; capital letters and commas don't matter.
  greetings: {
    civilian: ['good {tod}', 'good {tod} {sirmaam}'],
    poc:      ['good {tod} {address}'],
    cadre:    ['good {tod} {sirmaam}', 'good {tod} {address}'],
  },

  // The words for the commander's own salute (typed or spoken), and how long the hand stays up (s)
  saluteWords: ['salute', 'hand salute'],
  saluteSeconds: 2,

  // Who walks around campus (Live mode). Counts are per campus visit.
  people: {
    civilians: 22,           // students, faculty and staff
    poc: 6,                  // drawn from roster.js (FICTIONAL POC cadets)
    cadre: 2,                // drawn from roster.js (FICTIONAL cadre officers)
    walkSpeedMps: 1.3,
    civilianKinds: ['student', 'student', 'student', 'faculty', 'staff'],
    showNameMeters: 20,      // a POC/cadre name tag appears when they're this close to your flight commander
  },
};
