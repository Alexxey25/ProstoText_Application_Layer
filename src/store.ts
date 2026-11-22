import { configureStore, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { ChatState, SessionInfo, RequestMessage, ResultMessage } from '../shared/types.ts';
const initialState: ChatState = { user: null, connected: false, messages: [], pending: false };
const chat = createSlice({ name: 'chat', initialState, reducers: {
  login: (s, a: PayloadAction<SessionInfo>) => { s.user = a.payload; }, connection: (s, a: PayloadAction<boolean>) => { s.connected = a.payload; },
  waiting: (s, a: PayloadAction<boolean>) => { s.pending = a.payload; },
  sent: (s, a: PayloadAction<RequestMessage>) => { s.messages.push({ ...a.payload, parts: [], error: false, done: false }); },
  result: (s, a: PayloadAction<ResultMessage>) => {
    const m = s.messages.find(item => item.requestId === a.payload.requestId); if (!m) return;
    m.receivedAt = a.payload.sentAt;
    if (a.payload.error) { m.error = true; m.parts = []; m.done = true; }
    else { if (a.payload.simplifiedText && a.payload.partNumber && !m.parts.some(p => p.number === a.payload.partNumber)) m.parts.push({ number: a.payload.partNumber, text: a.payload.simplifiedText }); m.done = a.payload.isLast; }
    s.pending = !m.done;
  },
  disconnected: s => { s.connected = false; s.pending = false; for (const m of s.messages) if (!m.done) { m.error = true; m.parts = []; m.done = true; } },
  logout: () => initialState,
} });
export const actions = chat.actions;
export const store = configureStore({ reducer: chat.reducer });
export type AppDispatch = typeof store.dispatch;
