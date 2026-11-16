// =====================================================================
//  feedback-config.js: where cadets' feedback and bug reports go (DATA ONLY).
//  Decided (user, 2026-11-16): a Google Form owned by the user; responses land in a Google Sheet.
//  The in-game Feedback screen (ui.js showFeedbackScreen) opens the form with the cadet's text and
//  the game details already filled in; the cadet only clicks Submit on the form.
//
//  Connected 2026-11-16 to the user's form (question IDs read from the form's public page):
//    "Report Issue/Bug" (paragraph)  <- bugs, wrong drill rules, voice/timing problems
//    "Feedback" (paragraph)          <- ideas / requests / other
//    "Game Details" (short answer)   <- the automatic game details, on one line (" | " between items)
//  If the form's questions change, update the entry numbers below (⋮ → Get pre-filled link shows them).
// =====================================================================

const FEEDBACK = {
  formUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSe3Lhgt0yfkfy4F5JI9dtfjoZLhQ7SoY3-ICaEn1l3kzJzEhw/viewform',
  entries: { bug: 'entry.295734435', feedback: 'entry.1480312744', details: 'entry.1555000537' },
  bugTypes: ['Bug (something broke)', 'Drill rule is wrong', 'Voice / timing problem'],   // -> "Report Issue/Bug"
  detailsOneLine: true,   // "Game Details" is a short-answer question (one line)
  version: '2026-11-16',  // shown in reports so bugs can be matched to a version of the game
  types: ['Bug (something broke)', 'Drill rule is wrong', 'Voice / timing problem', 'Idea / request', 'Other'],
  maxDetails: 1500,       // characters of game details sent along (keeps the link short)
};
