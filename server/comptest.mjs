import express from 'express';
import compression from 'compression';

const app = express();
app.use(compression());

const bigPayload = JSON.stringify({ data: 'x'.repeat(50000) });

app.get('/big', (req, res) => res.json(JSON.parse(bigPayload)));

app.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  res.write(`event: snapshot\ndata: ${bigPayload}\n\n`);
  res.flush?.();
  setTimeout(() => res.end(), 200);
});

app.listen(3099, () => console.log('ready'));
