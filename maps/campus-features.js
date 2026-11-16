// =====================================================================
//  maps/campus-features.js: HAND-EDITED campus features that the map data (campus.osm)
//  doesn't have, traced from the user's annotated satellite screenshots
//  ("Max Morris Drill Field.pdf": route in blue, stairs in yellow, "Road Intersection" notes).
//
//  All positions are in METERS from the map's top-left corner (x = east, y = south),
//  the same system as tools/make-campus-data.py. Traced positions are approximate
//  (about +/- 3 m); intersections are snapped to the nearest path junction in the map data.
//  To adjust something, change the numbers and reload the game (no script to run).
// =====================================================================

const CAMPUS_FEATURES = {
  // Stairs the flight must take at ROUTE STEP (user's rule). Each one is a center line plus a
  // width (meters). treads: 'across' = you walk ALONG the line (steps cross it);
  //                         'along'  = you walk ACROSS the line (steps follow it, e.g. curved stairs).
  stairs: [
    { name: 'the plaza stairs (Village View Dining)', treads: 'along', width: 3,
      // curved stairs on the south side of the plaza, 13 m around the plaza junction
      line: [[259.7, 261.9], [263.9, 264.7], [268.9, 265.7], [273.9, 264.7], [278.1, 261.9]],
      source: 'yellow highlight, satellite screenshot' },
    { name: 'the stairs beside Village View Dining', treads: 'across', width: 3,
      line: [[278.0, 266.0], [278.0, 277.0]],
      source: 'yellow highlight, satellite screenshot (west side of the dining hall)' },
  ],

  // Intersections where road guards will post (procedure to be added later).
  // radius = how big the intersection area is (meters).
  intersections: [
    // roadGuards: false = no road guard procedure here (user, 2026-11-15: road guards are only used on the
    // long concourse through the Village)
    { name: 'S Donahue Dr & War Eagle Way', x: 457, y: 165, radius: 14, roadGuards: false,
      source: 'map data: traffic lights + 4 marked crosswalks; on the route Lowder -> drill field' },
    { name: 'Village plaza (Village View Dining)', x: 268.9, y: 252.7, radius: 6,
      source: 'user note "Road Intersection", snapped to the 4-way path junction' },
    { name: 'Village center crossing', x: 139.8, y: 252.6, radius: 6,
      source: 'user note "Road Intersection", snapped to the 4-way path junction' },
  ],
};
