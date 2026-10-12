/**
 * Headers for JSON requests to the MiniTalk server. Kept as a function (as in
 * SillyTavern) so auth/CSRF headers can be added later in one place.
 * @returns {Record<string, string>}
 */
export function getRequestHeaders() {
    return {
        'Content-Type': 'application/json',
    };
}
