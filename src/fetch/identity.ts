// How this system identifies itself to every site it contacts. A constant, not a
// setting: one honest identity, never rotated, never a browser string.

/** robots.txt product token. Site owners address rules to this name. */
export const ROBOTS_TOKEN = "CovenantStudiosBot";

/** Sent on every request. It names Covenant Studios and gives a contact URL. */
export const USER_AGENT = `${ROBOTS_TOKEN}/0.1 (+https://www.covenant-studios.co.za)`;
