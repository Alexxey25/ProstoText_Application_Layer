// Test double only. No Kafka, segment loss or LLM is simulated here.
import express from 'express';
import type { Request } from 'express';
import axios from 'axios';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RequestMessage, ResultMessage } from '../shared/types.ts';
const app = express();
app.use(express.json({ limit: '256kb' }));
app.post('/input', async (req: Request<object, unknown, RequestMessage>, res) => {
  const m = req.body; res.sendStatus(202);
  const send = (data: Pick<ResultMessage, 'error' | 'isLast'> & Partial<ResultMessage>) => axios.post(process.env.CALLBACK_URL || 'http://127.0.0.1:8000/receive', {
    sender: m.sender, sentAt: new Date().toISOString(), requestId: m.requestId, ...data,
  }, { proxy: false, timeout: 5000, headers: { 'X-Transport-Key': process.env.TRANSPORT_KEY || '' } });
  try {
    await sleep(650);
    if (m.complexText.trim() === '/ошибка') return await send({ error: true, isLast: true });
    const parts = /температур|кинетическ/i.test(m.complexText)
      ? ['При нагревании частицы вещества в среднем начинают двигаться быстрее.', 'Чем выше температура, тем больше средняя энергия их движения.']
      : ['Это тестовый ответ для проверки доставки сообщений.', 'Настоящее упрощение появится после подключения транспортного сервиса и локальной LLM.'];
    for (let i = 0; i < parts.length; i++) { await send({ simplifiedText: parts[i], partNumber: i + 1, error: false, isLast: i === parts.length - 1 }); await sleep(650); }
  } catch (e) { console.log(`Тестовый callback не доставлен: ${axios.isAxiosError(e) ? e.response?.status || e.code : 'неизвестная ошибка'}`); }
});
const port = Number(process.env.MOCK_PORT) || 8001;
app.listen(port, '127.0.0.1', () => console.log(`ТЕСТОВЫЙ транспорт: http://127.0.0.1:${port}/input. Это не LLM.`));
