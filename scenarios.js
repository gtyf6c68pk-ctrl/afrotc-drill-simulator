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
      'Parade, HEST', 'Flight, Ten-HUT', 'Present, HARMS', 'Order, HARMS', 'Right, HACE', 'Left, HACE',
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

  // TANKS (Phase 9): snake-style flanking game. Rules = the user's defaults until the Phase 9 review.
  tanks: {
    id: 'tanks', title: 'Tanks', mode: 'Tanks', map: 'DrillPad', hints: false,
    blurb: 'Hit enemy flights in the flank with your front before they hit yours. 3 lives, 3 waves.',
    pad: { w: 64, h: 64 },                       // arena = the whole pad (steps); your flight = Settings size
    start: null, timer: null, objectives: [],
    tanks: {
      lives: 3,
      contactPx: 26,              // people closer than this = the flights touched
      frontDepthPx: 12,           // the front rank (how deep "the front" of a flight is)
      edgeMarginPx: 20,           // closer than this to the arena edge = left the arena
      safeSeconds: 4,             // after losing a life
      laneSpacingSteps: 10, laneInsetSteps: 8,   // the lanes enemy flights march on
      dodgeRangePx: 300,          // an enemy in front of you within this distance tries to get away
      huntOffsetPx: 80,           // enemies aim this far beside your flank, then turn in
      attackRangePx: 520,         // within this distance they make the attack run
      aimEdgePx: 140,             // no attack runs toward a point this close to the arena edge
      enemyNames: ['B Flight', 'C Flight', 'D Flight'],
      waves: [                    // speed = enemy cadence / your cadence; replan = how often they re-think
        { enemies: 3, speed: 0.75, replanSeconds: 5, leadSteps: 0 },
        { enemies: 3, speed: 0.9, replanSeconds: 3.5, leadSteps: 4 },
        { enemies: 3, speed: 1.0, replanSeconds: 2.5, leadSteps: 8 },
      ],
    },
  },

  // ---------- LIVE MODE MISSIONS (Phase 11; campus, true scale; positions in METERS) ----------
  // Proposed from the user's route (CLAUDE.md "Campus realism") and AFROTCI 36-2011 Vol 1 (road guards,
  // courtesy, drill). Checkpoints are reached in order (the flight's center within r meters).
  liveLowder: {
    id: 'liveLowder', title: 'Lowder to the drill field', mode: 'Live', map: 'Campus', hints: false, endWhenComplete: true,
    blurb: 'March your flight from the Lowder Business Building to the Max Adams Morris Drill Field, with road guards at War Eagle Way.',
    briefing: [
      'Your flight is formed on the grass between Lowder and Horton-Hargrave, facing south.',
      'Route: south between the two buildings, west along the north sidewalk of the parking lot, then south down the east side of S Donahue Dr.',
      'Halt before the S Donahue Dr & War Eagle Way intersection and post road guards (Road Guards, OUT). March through, then Road Guards, IN.',
      'Finish on the Max Adams Morris Drill Field. Greet and salute the people you pass. Take stairs at route step.',
    ],
    start: { x: 526, y: 40, dir: 4 },
    route: [[526, 40], [526, 95], [464.5, 95], [464.5, 225], [415, 225]],   // on the sidewalk center lines
    objectives: [
      { type: 'checkpoint', id: 'between', label: 'Between Horton-Hargrave and Lowder', x: 526, y: 80, r: 12 },
      { type: 'checkpoint', id: 'lot', label: 'North sidewalk of the parking lot', x: 490, y: 95, r: 12 },
      { type: 'checkpoint', id: 'donahue', label: 'East sidewalk of S Donahue Dr', x: 464.5, y: 130, r: 12 },
      { type: 'checkpoint', id: 'warEagle', label: 'Across War Eagle Way (road guards)', x: 464.5, y: 185, r: 12 },
      { type: 'checkpoint', id: 'field', label: 'Max Adams Morris Drill Field', x: 420, y: 225, r: 16 },
    ],
  },
  liveField: {
    id: 'liveField', title: 'Drill on the Max Morris field', mode: 'Live', map: 'Campus', hints: false, endWhenComplete: true,
    blurb: 'Run a drill session on the Max Adams Morris Drill Field without leaving it.',
    briefing: [
      'Your flight is formed in the center of the Max Adams Morris Drill Field, facing north.',
      'Execute every movement on the list while staying inside the field. Commands given outside the field do not count.',
    ],
    start: { x: 420, y: 215, dir: 0 },
    area: { x0: 378, y0: 176, x1: 446, y1: 243 },          // the field (meters)
    route: null,
    objectives: [
      ['forward', 'Forward March', ['forward harch']], ['columnRight', 'Column Right', ['column right harch']],
      ['columnLeft', 'Column Left', ['column left harch']], ['rightFlank', 'Right Flank', ['right flank harch']],
      ['leftFlank', 'Left Flank', ['left flank harch']], ['toTheRear', 'To the Rear', ['to the rear harch']],
      ['halfStep', 'Half Step', ['half step harch']], ['markTime', 'Mark Time', ['mark time harch']],
      ['halt', 'Flight Halt', ['halt']], ['cover', 'Cover', ['cover']],
    ].map(([id, label, keys]) => ({ type: 'movement', id, label, keys })),
  },
  liveVillage: {
    id: 'liveVillage', title: 'Village loop', mode: 'Live', map: 'Campus', hints: false, endWhenComplete: true,
    blurb: 'West along Thach Concourse through the plaza (road guards), around a Village block and back.',
    briefing: [
      'Your flight is formed at the east end of Thach Concourse, facing west, next to the drill field.',
      'March west along the concourse. Halt before the Village plaza junction and post road guards.',
      'Turn north at the next corner, east along the sidewalk beside War Eagle Way, and south back to the concourse.',
      'Other flights use the concourse too: keep to your side. Greet and salute the people you pass.',
    ],
    start: { x: 400, y: 252.9, dir: 6 },
    route: [[400, 252.9], [220.6, 252.8], [221.2, 164.6], [311.1, 164.9], [311.1, 253.1]],
    objectives: [
      { type: 'checkpoint', id: 'plaza', label: 'Through the Village plaza (road guards)', x: 255, y: 252.8, r: 10 },
      { type: 'checkpoint', id: 'corner', label: 'Village corner', x: 220.6, y: 230, r: 12 },
      { type: 'checkpoint', id: 'north', label: 'North side (War Eagle Way)', x: 240, y: 164.7, r: 12 },
      { type: 'checkpoint', id: 'east', label: 'East side', x: 311, y: 190, r: 12 },
      { type: 'checkpoint', id: 'back', label: 'Back on the concourse', x: 311, y: 245, r: 12 },
    ],
  },
};

// Live mode difficulty presets (Settings → Live difficulty; also on the Live card)
const LIVE_DIFFICULTY = {
  easy:     { label: 'Easy',     npcFlights: 1, people: 0.6, routeLine: true,  prompts: true },
  standard: { label: 'Standard', npcFlights: 2, people: 1.0, routeLine: true,  prompts: true },
  hard:     { label: 'Hard',     npcFlights: 3, people: 1.4, routeLine: false, prompts: false },
};

// Live mode score: start at 100, minus these points per mistake (no less than 0)
const LIVE_SCORING = {
  start: 100,
  penalties: [
    { key: 'noRoadGuards', label: 'Crossed an intersection without road guards', points: 15 },
    { key: 'obstacle',     label: 'Marched into a building or obstacle',         points: 10 },
    { key: 'stairs',       label: 'Stairs at attention (route step!)',           points: 5 },
    { key: 'courtesyMissed', label: 'Greeting missed',                           points: 4 },
    { key: 'noSalute',     label: 'Officer not saluted',                         points: 4 },
    { key: 'courtesyWrong', label: 'Wrong greeting words',                       points: 2 },
    { key: 'offRoute',     label: 'Off the route (per 10 s)',                    points: 2 },
    { key: 'refused',      label: 'Command refused',                             points: 1 },
    { key: 'wrongFoot',    label: 'Command on the wrong foot',                   points: 1 },
  ],
  routeCorridorM: 25,      // further than this from the planned route = off route
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
