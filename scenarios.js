// =====================================================================
//  scenarios.js: the SCENARIOS (data only). Each one is run by ScenarioRun (scenario.js).
//  Add a scenario here; the menu and results screen pick it up. Fields are explained at the
//  top of scenario.js. FDE (Phase 7), Tanks (Phase 9) and Live missions (Phase 11) are added here.
// =====================================================================

const SCENARIOS = {
  // Practice mode: free drill on the pad, no timer, no pass/fail. The coach explains every mistake
  // (the correct command and when to give it); the results screen shows the session's grades.
  practice: {
    id: 'practice', title: 'Free practice', mode: 'Practice', map: 'DrillPad', hints: true,
    timer: null, area: null, objectives: [],
    blurb: 'Any command, any order. The coach explains each mistake. Finish to see your grades.',
  },

  // AFROTCI 36-2011 Vol 1, drill performance measure: "execute a 30-command drill sequence without error".
  sequence30: {
    id: 'sequence30', title: '30-command challenge', mode: 'Practice', map: 'DrillPad', hints: true,
    timer: null, area: null, endWhenComplete: true,
    objectives: [{ type: 'cleanStreak', id: 'streak', label: '30 commands in a row without an error', count: 30 }],
    blurb: 'Give 30 commands in a row without a single error (AFROTCI 36-2011 Vol 1). One mistake restarts the count.',
  },

  // FLIGHT DRILL EVALUATION (FDE): DAFPAM 34-1203 Attachment 7 scorecard (20 required movements) and
  // AFROTCI 36-2011 Vol 1 p. 58 instructions: flight of 12 + guidon bearer (3 elements, 4 ranks), drill
  // area at least 40 ft x 40 ft marked by four cones, 1-minute planning period (review the card, place
  // the flight anywhere), report in, the 5:00 timer starts at the first drill movement, movements in any
  // order, a boundary break = return to the area and continue (a movement commanded while out of bounds
  // does not count: user's rule), report out at the end. No /100 score is computed (user's decision):
  // the purpose is learning the most efficient ORDER of commands.
  fde: {
    id: 'fde', title: 'Flight Drill Evaluation', mode: 'FDE', map: 'DrillPad', hints: false,
    blurb: 'All 20 scorecard movements in under 5:00 inside the cones. Learn the most efficient order.',
    pad: { w: 44, h: 44, area: 20, elements: 3, elementSize: 4 },   // steps; area = 40 ft square of cones
    start: { x: 4.8, y: 14.5, dir: 0 },     // where the flight starts in the area (steps from its NW cone), facing North
    planningSeconds: 60,
    timer: { limitSeconds: 300, startOn: 'first-command' },
    reportIn:  { say: 'Sir/Ma\'am, A Flight is ready for drill evaluation.',
                 pattern: /^(sir|ma ?am|mam|maam) (\w+ )?flight is ready for (the )?drill evaluation$/ },
    reportOut: { say: 'Sir/Ma\'am, A Flight has completed the drill evaluation.',
                 pattern: /^(sir|ma ?am|mam|maam) (\w+ )?flight has completed (the )?drill evaluation$/ },
    timeoutMessage: 'Due to time constraints, the evaluation is terminated.',
    objectives: [
      ['leftFace', 'Left Face', ['left hace']], ['rightFace', 'Right Face', ['right hace']],
      ['aboutFace', 'About Face', ['about hace']], ['paradeRest', 'Parade Rest', ['parade hest']],
      ['attention', 'Attention', ['ten hut']], ['presentArms', 'Present Arms', ['present harms']],
      ['leftStep', 'Left Step', ['left step harch']], ['rightStep', 'Right Step', ['right step harch']],
      ['forward', 'Forward March', ['forward harch']], ['halfStep', 'Half Step', ['half step harch']],
      ['columnLeft', 'Column Left', ['column left harch']], ['columnRight', 'Column Right', ['column right harch']],
      ['leftFlank', 'Left Flank', ['left flank harch']], ['rightFlank', 'Right Flank', ['right flank harch']],
      ['toTheRear', 'To the Rear', ['to the rear harch']], ['changeStep', 'Change Step', ['change step harch']],
      ['orderArms', 'Order Arms', ['order harms']], ['markTime', 'Mark Time', ['mark time harch']],
      ['halt', 'Flight Halt', ['halt']], ['cover', 'Cover', ['cover']],
    ].map(([id, label, keys]) => ({ type: 'movement', id, label, keys })),
    // An efficient order (25 commands: the 20 movements + the halts/covers the side steps need + 2 Forwards
    // to leave mark time / half step). Checked by tests/fde.test.js: all 20 count, the flight stays inside
    // the cones from the start spot above, well under 5:00 at 60 or 120 steps/min.
    efficientOrder: [
      'Parade, HEST', 'Flight, Ten-HUT', 'Pre-sent, HARMS', 'Or-der, HARMS', 'Right, HACE', 'Left, HACE',
      'Right Step, HARCH', 'Flight, HALT', 'COVER', 'Left Step, HARCH', 'Flight, HALT', 'COVER', 'A-bout, HACE',
      'To the Rear, HARCH', 'Change Step, HARCH', 'Left Flank, HARCH', 'Right Flank, HARCH', 'Column Right, HARCH',
      'Mark Time, HARCH', 'Forward, HARCH', 'Half Step, HARCH', 'Forward, HARCH', 'Column Left, HARCH',
      'Flight, HALT', 'COVER',
    ],
    efficientNotes: [
      'Do every at-the-halt movement first, in one block: Parade Rest, Attention, Present/Order Arms, the facings and both side steps.',
      'Each side step ends with Flight, HALT and COVER, which also checks off Flight Halt and Cover.',
      'A-bout, HACE puts the flight in inverted column; To the Rear, HARCH from the halt turns it back into column and steps off in one command.',
      'Use the cheap movements (Change Step, flanks, Mark Time, Half Step) between the column movements so the flight stays inside the cones.',
      'Column movements end in a half step and need Forward, HARCH; plan them so that Forward also counts toward the card.',
    ],
  },
};

// Voice phrases for the FDE report in / out (the offline voice engine only listens for known phrases)
const REPORT_PHRASES = (() => {
  const who = ['sir', "ma'am", 'mam'], flights = ['', 'a ', 'b ', 'c ', 'd ', 'alpha ', 'bravo ', 'charlie ', 'delta '];
  const out = [];
  who.forEach(w => flights.forEach(fl => {
    out.push(w + ' ' + fl + 'flight is ready for drill evaluation', w + ' ' + fl + 'flight has completed the drill evaluation');
  }));
  return out;
})();
