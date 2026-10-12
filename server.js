#!/usr/bin/env node
// MiniTalk — server entry point.
//
// Environment:
//   MINITALK_PORT=8100        listen port
//   MINITALK_HOST=127.0.0.1   listen address (the storage API can write files
//                              anywhere in the app folder — keep it local)

import express from 'express';

import { EXTENSIONS_DIR, PUBLIC_DIR } from './src/paths.js';
import { router as chatCompletionsRouter } from './src/endpoints/chat-completions.js';
import { router as extensionStorageRouter } from './src/endpoints/extension-storage.js';
import { router as extensionsRouter } from './src/endpoints/extensions.js';
import { router as tokenizersRouter } from './src/endpoints/tokenizers.js';

const port = Number(process.env.MINITALK_PORT) || 8109;
const host = process.env.MINITALK_HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100mb' }));

app.use('/api/backends/chat-completions', chatCompletionsRouter);
app.use('/api/tokenizers', tokenizersRouter);
app.use('/api/extensions', extensionsRouter);
// Former server plugins, now core, kept at their plugin URLs for V2 extensions.
app.use('/api/plugins/extension-storage', extensionStorageRouter);

app.use(express.static(PUBLIC_DIR));
app.use('/extensions', express.static(EXTENSIONS_DIR));

app.listen(port, host, () => {
    console.log(`MiniTalk is running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
}).on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Set MINITALK_PORT to a free port.`
        : err);
    process.exit(1);
});
