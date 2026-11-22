import { test } from 'node:test';
import type { TestContext } from 'node:test';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApp } from '../server/app.ts';
import type { ServiceOptions } from '../server/app.ts';
import { store, actions } from '../src/store.ts';
import type { RequestMessage, ResultMessage, SessionInfo } from '../shared/types.ts';

async function fixture(t: TestContext, options: ServiceOptions = {}) {
  const incoming: RequestMessage[] = [];
  const transport = express(); transport.use(express.json());
  transport.post('/input', (req, res) => { incoming.push(req.body); res.sendStatus(202); });
  const upstream = transport.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const service = createApp({ transportUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/input`, ...options });
  const server = service.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const controllers: AbortController[] = [];
  t.after(() => { for (const c of controllers) c.abort(); service.close(); server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); });
  async function call(path: string, data?: unknown, sessionId?: string, method = 'POST', extra: Record<string, string> = {}) {
    return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'X-Session-Id': sessionId } : {}), ...extra }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  async function login(name = 'Алексей') {
    const r = await call('/session', { name }); const user = await r.json() as SessionInfo;
    const c = new AbortController(); controllers.push(c);
    const events = await fetch(`${base}/events?sessionId=${user.sessionId}`, { signal: c.signal });
    const reader = events.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
    async function event<T = ResultMessage>(): Promise<T> {
      while (true) {
        const cut = buffer.indexOf('\n\n');
        if (cut >= 0) {
          const chunk = buffer.slice(0, cut); buffer = buffer.slice(cut + 2);
          const line = chunk.split('\n').find(v => v.startsWith('data: '));
          if (line) return JSON.parse(line.slice(6)) as T;
        } else { const { value, done } = await reader.read(); if (done) throw new Error('SSE closed'); buffer += decoder.decode(value, { stream: true }); }
      }
    }
    await event<{ name: string }>(); return { ...user, event, abort: () => c.abort() };
  }
  async function send(user: SessionInfo, complexText = 'Сложный текст', more: Partial<RequestMessage> = {}): Promise<RequestMessage> { return (await call('/send', { complexText, ...more }, user.sessionId)).json() as Promise<RequestMessage>; }
  function result(user: SessionInfo, m: RequestMessage, more: Partial<ResultMessage> = {}): ResultMessage { return { sender: user.name, requestId: m.requestId, sentAt: new Date().toISOString(), error: false, isLast: true, partNumber: 1, simplifiedText: 'Простой текст', ...more }; }
  return { base, incoming, call, login, send, result };
}
test('HTTP health, Swagger and production /api prefix', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/health')).status, 200);
  assert.equal((await fetch(f.base + '/api/health')).status, 200);
  assert.equal((await fetch(f.base + '/docs/')).status, 200);
});
test('blank names, whitespace and invalid sessions rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/session', { name: '  ' })).status, 400);
  assert.equal((await f.call('/send', { complexText: 'a' }, 'bad')).status, 401);
  const u = await f.login(); assert.equal((await f.call('/send', { complexText: ' ' }, u.sessionId)).status, 400);
});
test('two parts arrive over a real SSE stream; upstream receives topic fields', async t => {
  const f = await fixture(t), u = await f.login(), m = await f.send(u);
  for (let i=0; !f.incoming.length && i<50; i++) await new Promise(r => setTimeout(r,10));
  assert.equal(f.incoming[0].sender, u.name); assert.equal(f.incoming[0].requestId, m.requestId); assert.equal(f.incoming[0].complexText, m.complexText);
  for (let i=1;i<=2;i++) { assert.equal((await f.call('/receive', f.result(u,m,{partNumber:i,isLast:i===2}))).status,200); const data=await u.event(); assert.equal(data.partNumber,i); assert.equal(data.isLast,i===2); }
});
test('separate completion, duplicate part and concurrent request', async t => {
  const f=await fixture(t),u=await f.login(),m=await f.send(u);
  assert.equal((await f.call('/send',{complexText:'Ещё'},u.sessionId)).status,409);
  await f.call('/receive',f.result(u,m,{isLast:false})); await u.event();
  assert.equal((await f.call('/receive',f.result(u,m,{isLast:false}))).status,200);
  const completion=f.result(u,m,{isLast:true,partCount:1}); delete completion.simplifiedText; delete completion.partNumber;
  await f.call('/receive',completion); assert.equal((await u.event()).partCount,1);
});
test('error content never reaches browser; Redux removes partial answer', async t => {
  const f=await fixture(t),u=await f.login(),m=await f.send(u);
  await f.call('/receive',f.result(u,m,{error:true,simplifiedText:'SECRET'})); const data=await u.event();
  assert.equal(data.error,true); assert.equal(data.simplifiedText,undefined);
  store.dispatch(actions.logout());store.dispatch(actions.sent(m));store.dispatch(actions.result(f.result(u,m,{isLast:false})));
  store.dispatch(actions.result(data));assert.equal(store.getState().messages[0].parts.length,0);
  store.dispatch(actions.logout()); assert.deepEqual(store.getState().messages,[]);
});
test('sessions with identical names are isolated by request ID', async t => {
  const f=await fixture(t),a=await f.login('Одинаково'),b=await f.login('Одинаково');
  const ma=await f.send(a),mb=await f.send(b);
  await f.call('/receive',f.result(b,mb));assert.equal((await b.event()).requestId,mb.requestId);
  await f.call('/receive',f.result(a,ma));assert.equal((await a.event()).requestId,ma.requestId);
});
test('missing part and wrong count produce an error', async t => {
  const f=await fixture(t),u=await f.login(),m=await f.send(u);
  await f.call('/receive',f.result(u,m,{partNumber:2}));assert.equal((await u.event()).error,true);
  const m2=await f.send(u);const end=f.result(u,m2,{partCount:8});delete end.simplifiedText;
  await f.call('/receive',end);assert.equal((await u.event()).error,true);
});
test('invalid callback, wrong recipient and optional transport key', async t => {
  const f=await fixture(t,{transportKey:'test-key'}),u=await f.login(),m=await f.send(u),headers={'X-Transport-Key':'test-key'};
  assert.equal((await f.call('/receive',f.result(u,m))).status,401);
  assert.equal((await f.call('/receive',{},undefined,'POST',headers)).status,400);
  assert.equal((await f.call('/receive',f.result(u,m,{sender:'Другой'}),undefined,'POST',headers)).status,400);
  assert.equal((await f.call('/receive',f.result(u,m),undefined,'POST',headers)).status,200);await u.event();
});
test('TXT is delivered as base64 and text, mismatched file is rejected', async t => {
  const f=await fixture(t),u=await f.login(),txt='Температура растёт.';
  const file={name:'text.txt',mimeType:'text/plain' as const,base64:Buffer.from(txt).toString('base64')};
  assert.equal((await f.call('/send',{complexText:'Другой',file},u.sessionId)).status,400);
  const m=await f.send(u,txt,{file});assert.ok(m.file);assert.equal(m.file.base64,file.base64);
  await f.call('/receive',f.result(u,m));await u.event();
});
test('logout invalidates session and pending request', async t => {
  const f=await fixture(t),u=await f.login(),m=await f.send(u);
  assert.equal((await f.call('/session',undefined,u.sessionId,'DELETE')).status,204);
  assert.equal((await f.call('/receive',f.result(u,m))).status,404);
  assert.equal((await f.call('/send',{complexText:'a'},u.sessionId)).status,401);
});
test('upstream unavailable and response timeout are surfaced as errors', async t => {
  const f=await fixture(t,{transportUrl:'http://127.0.0.1:1/input'}),u=await f.login();await f.send(u);assert.equal((await u.event()).error,true);
  const g=await fixture(t,{requestTimeout:80}),v=await g.login();await g.send(v);assert.equal((await v.event()).error,true);
});
