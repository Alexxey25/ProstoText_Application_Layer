import { createApp } from './app.ts';
const { app, close } = createApp({ transportUrl: process.env.TRANSPORT_URL, transportKey: process.env.TRANSPORT_KEY, requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS) || 120000 });
const port = Number(process.env.PORT) || 8000, host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`ПростоТекст: http://${host}:${port} | Swagger: /docs | SSE: /events`));
function stop() { close(); server.close(() => process.exit()); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
