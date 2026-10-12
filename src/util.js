import { Readable } from 'node:stream';

/**
 * An error carrying the HTTP status the route should answer with.
 */
export class HttpError extends Error {
    /**
     * @param {number} status
     * @param {string} message
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/**
 * Sends an error in the shape the frontend (and ST-era extensions, which only
 * check that `error` is truthy) expect.
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} message
 */
export function sendError(res, status, message) {
    // A 401 would make the browser drop its Basic auth credentials (same
    // convention as SillyTavern), so report it as a 400.
    const safeStatus = status === 401 ? 400 : (status || 500);
    if (res.headersSent) {
        return res.end();
    }
    return res.status(safeStatus).json({ error: { message } });
}

/**
 * Returns an AbortController that fires when the client disconnects before
 * the response has finished, so upstream requests are cancelled with it.
 * @param {import('express').Response} res
 * @returns {AbortController}
 */
export function abortOnClientClose(res) {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) {
            controller.abort();
        }
    });
    return controller;
}

/**
 * Pipes an upstream fetch Response (e.g. an SSE stream) to the client untouched.
 * @param {Response} from
 * @param {import('express').Response} to
 */
export function forwardFetchResponse(from, to) {
    to.status(from.status === 401 ? 400 : from.status);
    const contentType = from.headers.get('content-type');
    if (contentType) {
        to.setHeader('Content-Type', contentType);
    }
    to.setHeader('Cache-Control', 'no-cache');

    if (!from.body) {
        return to.end();
    }

    const body = Readable.fromWeb(/** @type {any} */ (from.body));
    // Without an error listener an aborted upstream would crash the process.
    body.on('error', () => to.end());
    to.on('close', () => body.destroy());
    body.pipe(to);
}
