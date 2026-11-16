// =====================================================================
//  feedback-config.js: where cadets' feedback and bug reports go (DATA ONLY).
//  Decided (user, 2026-11-16): a Google Form owned by the user; responses land in a Google Sheet.
//  The in-game Feedback screen (ui.js showFeedbackScreen) opens the form with the cadet's text and
//  the game details already filled in; the cadet only clicks Submit on the form.
//
//  To connect it: in the form, ⋮ → "Get pre-filled link", type TYPE, TEXT and DETAILS into the three
//  questions, "Get link", copy it, and paste it below as prefillLink (or send it to Claude).
// =====================================================================

const FEEDBACK = {
  prefillLink: null,      // e.g. 'https://docs.google.com/forms/d/e/1FAIpQ.../viewform?usp=pp_url&entry.111=TYPE&entry.222=TEXT&entry.333=DETAILS'
  version: '2026-11-16',  // shown in reports so bugs can be matched to a version of the game
  types: ['Bug (something broke)', 'Drill rule is wrong', 'Voice / timing problem', 'Idea / request', 'Other'],
  maxDetails: 1500,       // characters of game details sent along (keeps the link short)
};
