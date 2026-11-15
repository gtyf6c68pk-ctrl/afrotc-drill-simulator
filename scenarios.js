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
};
