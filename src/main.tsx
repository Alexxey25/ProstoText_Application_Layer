import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { Button, CssBaseline, IconButton, TextField, ThemeProvider, createTheme } from '@mui/material';
import axios from 'axios';
import { actions, store } from './store.ts';
import type { AppDispatch } from './store.ts';
import type { ChatState, SessionInfo, RequestMessage, ResultMessage, TextFile } from '../shared/types.ts';
import './style.css';
const api = axios.create({ baseURL: '/api', timeout: 12000 });
const theme = createTheme({ typography: { fontFamily: 'Arial, Helvetica, sans-serif', button: { textTransform: 'none', fontSize: 16 } }, palette: { primary: { main: '#000000', dark: '#C6B09F', contrastText: '#FFFFFF' } }, shape: { borderRadius: 6 } });
const time = (v: string) => new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const explain = (e: unknown) => axios.isAxiosError<{ message?: string }>(e) && e.response?.data?.message || 'Сервер недоступен. Проверьте подключение.';
function App() {
  const { user, connected, messages, pending } = useSelector((s: ChatState) => s), dispatch = useDispatch<AppDispatch>();
  const [name, setName] = useState(''), [text, setText] = useState(''), [file, setFile] = useState<TextFile | null>(null);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const stream = useRef<EventSource | null>(null), early = useRef<ResultMessage[]>([]), scrolling = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!user) return;
    const events = new EventSource(`/api/events?sessionId=${encodeURIComponent(user.sessionId)}`); stream.current = events;
    events.addEventListener('ready', () => dispatch(actions.connection(true)));
    events.addEventListener('result', event => {
      const data = JSON.parse(event.data) as ResultMessage;
      if (store.getState().messages.some(m => m.requestId === data.requestId)) dispatch(actions.result(data)); else early.current.push(data);
    });
    events.onerror = () => dispatch(actions.disconnected());
    const leave = () => { events.close(); fetch('/api/session', { method: 'DELETE', headers: { 'X-Session-Id': user.sessionId }, keepalive: true }); };
    window.addEventListener('pagehide', leave);
    return () => { events.close(); window.removeEventListener('pagehide', leave); };
  }, [user, dispatch]);
  useEffect(() => { scrolling.current?.scrollTo({ top: scrolling.current.scrollHeight, behavior: 'smooth' }); }, [messages]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setNotice(''); setBusy(true);
    try { dispatch(actions.login((await api.post<SessionInfo>('/session', { name })).data)); } catch (e) { setNotice(explain(e)); } finally { setBusy(false); }
  }
  async function logout() {
    if (!user) return;
    stream.current?.close();
    try { await api.delete('/session', { headers: { 'X-Session-Id': user.sessionId } }); } catch { /* clear locally even if server is offline */ }
    dispatch(actions.logout()); setName(''); setText(''); setFile(null); setNotice(''); early.current = [];
  }
  async function send(e: Pick<FormEvent, 'preventDefault'>) {
    e.preventDefault(); if (!user || !text.trim() || pending || !connected) return;
    setNotice(''); dispatch(actions.waiting(true));
    try {
      const { data } = await api.post<RequestMessage>('/send', { complexText: text, ...(file ? { file } : {}) }, { headers: { 'X-Session-Id': user.sessionId } });
      dispatch(actions.sent(data)); for (const item of early.current) dispatch(actions.result(item)); early.current = [];
      setText(''); setFile(null);
    } catch (e) { dispatch(actions.waiting(false)); setNotice(explain(e)); }
  }
  async function attach(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return; setNotice('');
    try {
      if (!/\.txt$/i.test(selected.name) || selected.size > 65536) throw new Error('Выберите TXT-файл в UTF-8 размером до 64 КБ.');
      const bytes = new Uint8Array(await selected.arrayBuffer()), value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!value.trim() || value.length > 20000) throw new Error('В файле должно быть от 1 до 20 000 символов.');
      setText(value); setFile({ name: selected.name, mimeType: 'text/plain', base64: btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')) });
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось прочитать файл.'); }
  }
  return <><header><a className="logo" href="/">ПростоТекст</a>{user && <div className="account"><span>{user.name}</span><Button variant="outlined" className="logout" onClick={logout}>Выйти</Button></div>}</header>
    {!user ? <main className="login"><form onSubmit={login} className="login-form"><h1>Упростим сложный текст</h1><p className="muted login-subtitle">Введите имя, чтобы начать</p><div className="login-fields"><label htmlFor="name">Ваше имя</label><TextField id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Например, Алексей" autoComplete="off" inputProps={{ maxLength: 40, 'aria-label': 'Ваше имя' }} fullWidth/><Button type="submit" variant="contained" disableElevation disabled={!name.trim() || busy}>Войти</Button></div><p className="muted meta login-note">Имя будет видно в чате</p>{notice && <p role="alert" className="notice">{notice}</p>}</form></main>
    : <main className="chat"><section className="chat-title"><h1>Упрощение текста</h1><p className="muted">Отправьте текст — получите простое объяснение</p></section><div ref={scrolling} className="messages" aria-live="polite">
      {!messages.length && <p className="empty muted">Введите текст в поле ниже или прикрепите TXT-файл.</p>}
      {messages.map(m => <article className="exchange" key={m.requestId}><div className="user-message"><p className="meta muted">{m.sender} · {time(m.sentAt)}</p><div className="bubble">{m.file && <p className="file-name">{m.file.name}</p>}{m.complexText}</div></div><div className="answer"><p className="meta muted">Помощник · {time(m.receivedAt || m.sentAt)}</p>{m.error ? <p className="error-result" role="alert"><img src="/assets/error.svg" alt="Ошибка"/>Не удалось получить сообщение</p> : <>{m.parts.map(part => <p key={part.number} className="answer-part">{part.text}</p>)}<p className="meta muted">{m.done ? 'Ответ завершён' : 'Получаем ответ…'}</p></>}</div></article>)}
      </div>{!connected && <p role="status" className="connection muted">Подключаемся к серверу… При обрыве незавершённый ответ нужно отправить повторно.</p>}{notice && <p role="alert" className="notice">{notice}</p>}
      <form onSubmit={send} className="composer"><textarea aria-label="Текст для упрощения" placeholder="Введите текст для упрощения…" value={text} maxLength={20000} onChange={e => { setText(e.target.value); setFile(null); }} disabled={pending} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }}/><div className="composer-actions"><IconButton component="label" aria-label="Прикрепить TXT-файл" disabled={pending}><img src="/assets/attach.svg" alt=""/><input hidden type="file" accept=".txt,text/plain" onChange={attach}/></IconButton>{file && <span className="meta muted attached">{file.name}</span>}<IconButton type="submit" className="send-button" aria-label="Отправить" disabled={!text.trim() || pending || !connected}><img src="/assets/send.svg" alt=""/></IconButton></div></form>
    </main>}</>;
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><ThemeProvider theme={theme}><CssBaseline/><App/></ThemeProvider></Provider>);
