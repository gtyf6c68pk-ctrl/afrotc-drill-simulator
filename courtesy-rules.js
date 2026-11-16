// =====================================================================
//  courtesy-rules.js: MILITARY COURTESY rules for Live mode (DATA ONLY; Phase 10).
//
//  GREETING WORDING: from the user's detachment (2026-11-15). Salute rules marked "DAFPAM" come from
//  DAFPAM 34-1203 (3.6). Items still marked PLACEHOLDER are stand-ins to confirm.
//  Edit this file and reload: the game, its grading and the voice phrases all read it.
// =====================================================================

const COURTESY = {
  confirmed: true,           // greeting wording confirmed by the user (2026-11-15); see PLACEHOLDER items below

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

  // What to say to each kind of person (user's detachment, 2026-11-15):
  //   civilians: "Pardon my flight please, Sir/Ma'am"
  //   POC:       "Good morning, C/Rank Last Name"  (e.g. "Good morning, Cadet Captain Reed")
  //   cadre:     "Good morning, Rank Last Name"    (e.g. "Good morning, Captain Moore")
  //   a GROUP of POC: "Good morning, gentlemen" (all male) / "Good morning, ladies" (all female)
  //   {tod} = morning / afternoon / evening, {sirmaam} = sir / ma'am, {rank} = the full rank
  //   ("Cadet Captain", "Lieutenant Colonel"), {address} = the short form ("Cadet Colonel" for a
  //   C/Lt Col, "Colonel" for a Lt Col), {abbr} = as written ("C/Capt", "Lt Col"), {last} = last name.
  // Any listed form is accepted; capital letters, commas and the slash don't matter.
  greetings: {
    civilian: ['pardon my flight please {sirmaam}', 'pardon my flight {sirmaam}'],
    poc:      ['good {tod} {rank} {last}', 'good {tod} {address} {last}', 'good {tod} {abbr} {last}'],
    cadre:    ['good {tod} {rank} {last}', 'good {tod} {address} {last}', 'good {tod} {abbr} {last}'],
  },
  groupGreetings: {           // two or more POC walking together
    male: ['good {tod} gentlemen'],
    female: ['good {tod} ladies'],
    mixed: ['good {tod} ladies and gentlemen'],   // PLACEHOLDER: mixed groups weren't specified
  },

  // Rank insignia drawn on the people's rank tabs (Live mode; user approved 2026-11-15).
  //  POC (AFROTC supplement to DAFI 36-2903): "metallic black and silver cadet officer rank insignia",
  //  worn centered on the OCP chest rank tab, bars horizontal. Number of marks per grade = the standard
  //  Air Force cadet officer pattern: 1-3 stripes (lieutenants, captain), 1-3 diamonds (field grade).
  //  Cadre (active duty, OCP): Capt = two bars, Lt Col = oak leaf, Maj = oak leaf (gold), Col = eagle.
  insignia: {
    'C/2d Lt': { tab: 'cadet', stripes: 1 }, 'C/1st Lt': { tab: 'cadet', stripes: 2 }, 'C/Capt': { tab: 'cadet', stripes: 3 },
    'C/Maj': { tab: 'cadet', diamonds: 1 }, 'C/Lt Col': { tab: 'cadet', diamonds: 2 }, 'C/Col': { tab: 'cadet', diamonds: 3 },
    '2d Lt': { tab: 'ocp', bars: 1 }, '1st Lt': { tab: 'ocp', bars: 1 }, 'Capt': { tab: 'ocp', bars: 2 },
    'Maj': { tab: 'ocp', leaf: true }, 'Lt Col': { tab: 'ocp', leaf: true }, 'Col': { tab: 'ocp', eagle: true },
  },

  // The words for the commander's own salute (typed or spoken), and how long the hand stays up (s)
  saluteWords: ['salute', 'hand salute'],
  saluteSeconds: 2,

  // Who walks around campus (Live mode). Counts are per campus visit.
  people: {
    civilians: 22,           // students, faculty and staff
    poc: 6,                  // drawn from roster.js (FICTIONAL POC cadets)
    pocGroups: [3, 2],       // of those, groups that walk together (same sex): a 3 and a 2; the rest alone
    cadre: 2,                // drawn from roster.js (FICTIONAL cadre officers)
    walkSpeedMps: 1.3,
    civilianKinds: ['student', 'student', 'student', 'faculty', 'staff'],
    showNameMeters: 20,      // a POC/cadre name tag appears when they're this close to your flight commander
  },
};
