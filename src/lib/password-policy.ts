// Household password policy. It lives outside `$lib/server` because the input
// placeholders advertise the number too, and a minimum that is written down in
// six places is a minimum that will one day disagree with itself.

export const PASSWORD_MIN_LENGTH = 8;

/** "8+ characters", for a placeholder that cannot drift from the guard. */
export const PASSWORD_HINT = `${PASSWORD_MIN_LENGTH}+ characters`;
