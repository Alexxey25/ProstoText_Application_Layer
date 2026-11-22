import express from 'express';
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';
import type { RequestMessage, ResultMessage } from '../shared/types.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const isDate = (v: unknown) => typeof v === 'string' && /T/.test(v) && !Number.isNaN(Date.parse(v));
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;
interface Session { name: string; stream: Response | null; expiry?: ReturnType<typeof setTimeout> }
interface PendingRequest { sessionId: string; nextPart: number; timer: ReturnType<typeof setTimeout> }
export interface ServiceOptions { transportUrl?: string; transportKey?: string; requestTimeout?: number }

export function createApp({ transportUrl = 'http://127.0.0.1:8001/input', transportKey = '', requestTimeout = 120000 }: ServiceOptions = {}) {
  const app = express(), sessions = new Map<string, Session>(), requests = new Map<string, PendingRequest>();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const spec = YAML.parse(readFileSync(`${root}/application.openapi.yaml`, 'utf8'));
  app.get('/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(`${root}/application.openapi.yaml`));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/health', (_req, res) => res.json({ status: 'ok', protocol: 'SSE' }));
  function emit(session: Session, name: string, data: ResultMessage | { name: string }) { session.stream?.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); }
  function finish(id: string) { const r = requests.get(id); if (r) { clearTimeout(r.timer); requests.delete(id); } }
  function fail(id: string) {
    const r = requests.get(id); if (!r) return;
    const s = sessions.get(r.sessionId);
    if (s) emit(s, 'result', { sender: s.name, sentAt: new Date().toISOString(), requestId: id, error: true, isLast: true });
    finish(id);
  }
  function removeSession(id: string) {
    const s = sessions.get(id); if (!s) return;
    clearTimeout(s.expiry); const stream = s.stream; s.stream = null; stream?.end(); sessions.delete(id);
    for (const [key, r] of requests) if (r.sessionId === id) finish(key);
  }
  function authorized(req: Request, res: Response, next: NextFunction) {
    const id = req.get('X-Session-Id');
    const session = id ? sessions.get(id) : undefined;
    if (!session) return res.status(401).json({ message: 'Войдите в приложение заново.' });
    res.locals.sessionId = id; res.locals.session = session;
    next();
  }
  app.post('/session', (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) return res.status(400).json({ message: 'Введите имя от 1 до 40 символов.' });
    const sessionId = randomUUID();
    sessions.set(sessionId, { name: name.trim(), stream: null, expiry: setTimeout(() => removeSession(sessionId), 30000) });
    res.status(201).json({ sessionId, name: name.trim() });
  });
  app.get('/events', (req, res) => {
    const id = req.query.sessionId;
    const s = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!s || typeof id !== 'string') return res.status(401).end();
    clearTimeout(s.expiry); s.stream?.end();
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); s.stream = res;
    res.write('retry: 2000\n\n'); emit(s, 'ready', { name: s.name });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.on('close', () => {
      clearInterval(heartbeat); if (s.stream !== res) return;
      s.stream = null;
      // No replay/history: unfinished answers must be requested again.
      for (const [key, r] of requests) if (r.sessionId === id) finish(key);
      s.expiry = setTimeout(() => removeSession(id), 30000);
    });
  });
  app.delete('/session', authorized, (_req, res) => { removeSession(res.locals.sessionId); res.sendStatus(204); });
  app.post('/send', authorized, async (req: Request<object, unknown, Partial<RequestMessage>>, res) => {
    const session: Session = res.locals.session;
    const sessionId: string = res.locals.sessionId;
    const { complexText, file } = req.body || {};
    if (typeof complexText !== 'string' || !complexText.trim() || complexText.length > 20000) return res.status(400).json({ message: 'Требуется текст от 1 до 20 000 символов.' });
    if (!session.stream) return res.status(409).json({ message: 'Дождитесь подключения к серверу.' });
    if ([...requests.values()].some(r => r.sessionId === sessionId)) return res.status(409).json({ message: 'Дождитесь текущего ответа.' });
    if (file && (typeof file.name !== 'string' || !/\.txt$/i.test(file.name) || file.name.length > 200 || file.mimeType !== 'text/plain' || typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))) return res.status(400).json({ message: 'Поддерживается TXT-файл в UTF-8.' });
    if (file) {
      const bytes = Buffer.from(file.base64, 'base64');
      try { if (bytes.length > 65536 || new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim() !== complexText.trim()) throw new Error(); }
      catch { return res.status(400).json({ message: 'Файл должен содержать отправляемый текст в UTF-8, не более 64 КБ.' }); }
    }
    const requestId = randomUUID();
    const message: RequestMessage = { sender: session.name, sentAt: new Date().toISOString(), requestId, complexText: complexText.trim(), ...(file ? { file } : {}) };
    requests.set(requestId, { sessionId, nextPart: 1, timer: setTimeout(() => fail(requestId), requestTimeout) });
    // The ID reaches the browser before any upstream callback.
    res.status(202).json(message);
    try { await axios.post(transportUrl, message, { timeout: 10000, proxy: false, maxRedirects: 0 }); }
    catch { fail(requestId); }
  });
  app.post('/receive', (req: Request<object, unknown, ResultMessage>, res) => {
    if (transportKey && req.get('X-Transport-Key') !== transportKey) return res.sendStatus(401);
    const m = req.body;
    if (!m || typeof m.requestId !== 'string' || typeof m.sender !== 'string' || !isDate(m.sentAt) || typeof m.error !== 'boolean' || typeof m.isLast !== 'boolean') return res.status(400).json({ message: 'Некорректное сообщение.' });
    const r = requests.get(m.requestId), s = r && sessions.get(r.sessionId);
    if (!r || !s?.stream) return res.sendStatus(404);
    if (s.name !== m.sender) return res.status(400).json({ message: 'Имя не соответствует запросу.' });
    if (m.error) { fail(m.requestId); return res.sendStatus(200); }
    const text = typeof m.simplifiedText === 'string' && !!m.simplifiedText.trim() && m.simplifiedText.length <= 20000;
    const completed = !('simplifiedText' in m) && m.isLast && typeof m.partCount === 'number' && Number.isInteger(m.partCount) && m.partCount >= 0;
    if ((!text || !positive(m.partNumber)) && !completed) return res.sendStatus(400);
    if (text && positive(m.partNumber) && m.partNumber < r.nextPart) return res.sendStatus(200);
    if ((text && m.partNumber !== r.nextPart) || (completed && m.partCount !== r.nextPart - 1)) { fail(m.requestId); return res.sendStatus(200); }
    emit(s, 'result', { sender: m.sender, sentAt: m.sentAt, requestId: m.requestId, error: false, isLast: m.isLast,
      ...(text ? { partNumber: m.partNumber, simplifiedText: m.simplifiedText } : { partCount: m.partCount }) });
    if (text) r.nextPart++;
    if (m.isLast) finish(m.requestId);
    res.sendStatus(200);
  });
  // Production uses the same /api prefix as the Vite proxy.
  app.use('/api', (req, res, next) => app(req, res, next));
  app.use(express.static(`${root}/dist`));
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => res.status(err.status || 500).json({ message: err.status === 413 ? 'Сообщение слишком большое.' : 'Не удалось обработать запрос.' });
  app.use(handleError);
  return { app, close: () => { for (const id of sessions.keys()) removeSession(id); } };
}
