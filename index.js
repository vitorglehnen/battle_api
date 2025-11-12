const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();
const rateLimit = require('express-rate-limit'); // --- MUDANÇA: Importa o rate limit

const app = express();
const cache = new Map();

// --- MUDANÇA: Define tempos de cache mais estratégicos ---
const CACHE_TIME_FAST_MS = 5 * 1000;      // 5 segundos para queries rápidas (id, count, exp)
const CACHE_TIME_SLOW_MS = 30 * 1000; // 30 segundos para a query LENTA (GET /post)

// --- MUDANÇA: Proteção contra DoS (Rate Limiting) ---
// Permite 100 requisições por IP a cada 1 minuto
const limiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 1 minuto
	max: 60000, // Limite de 100 reqs por IP por janela
	message: 'Muitas requisições deste IP. Tente novamente em 1 minuto.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter); // Aplica o limite a TODAS as rotas
// --- FIM DA MUDANÇA ---

// --- MUDANÇA: Proteção contra DoS (Payload Gigante) ---
// Limita o body do JSON a 10kb. Evita que enviem um JSON de 50MB.
app.use(express.json({ limit: '10kb' }));
// --- FIM DA MUDANÇA ---


// Middleware de Autenticação (sem mudanças)
const basicAuthMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.set('WWW-Authenticate', 'Basic realm="API Battle - Acesso Restrito"');
    return res.status(401).json({ error: 'Autenticação necessária.' });
  }
  const token = authHeader.split(' ')[1];
  let decodedCredentials;
  try {
    decodedCredentials = Buffer.from(token, 'base64').toString('utf-8');
  } catch (e) {
    return res.status(400).json({ error: 'Token de autenticação mal formatado.' });
  }
  const [user, pass] = decodedCredentials.split(':');
  const expectedUser = 'adminho';
  const expectedPass = 'adminho';
  if (user === expectedUser && pass === expectedPass) {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="API Battle - Acesso Restrito"');
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
};
app.use(basicAuthMiddleware);

// Pool de Conexão
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});
pool.on('connect', () => {
  console.log('Conectado ao PostgreSQL!');
});

// 1. POST /post
app.post('/post', async (req, res) => {
  // --- MUDANÇA: Validação de tipo (simples) ---
  const { quem, comentario, tags } = req.body;
  if (!quem || !comentario || typeof quem !== 'string' || typeof comentario !== 'string') {
    return res.status(400).json({ error: 'Campos "quem" e "comentario" são obrigatórios e devem ser strings.' });
  }
  // --- FIM DA MUDANÇA ---
  try {
    const result = await pool.query(
      'INSERT INTO posts (quem, comentario, tags) VALUES ($1, $2, $3) RETURNING *',
      // Garante que tags seja um array ou nulo
      [quem, comentario, Array.isArray(tags) ? tags : []]
    );
    console.log('Cache limpo para /post/count e /post');
    cache.delete('/post/count');
    cache.delete('/post');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao inserir post.' });
  }
});

// 2. GET /post/count
app.get('/post/count', async (req, res) => {
  const cacheKey = '/post/count';
  const cachedData = cache.get(cacheKey);
  // Usa o cache rápido
  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TIME_FAST_MS)) {
    console.log('Hit no cache para: /post/count');
    return res.json(cachedData.data);
  }
  try {
    const result = await pool.query('SELECT COUNT(*) AS total FROM posts');
    const data = result.rows[0];
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao contar posts.' });
  }
});

// 3. GET /post (A ROTA LENTA)
app.get('/post', async (req, res) => {
  const cacheKey = '/post';
  const cachedData = cache.get(cacheKey);
  // --- MUDANÇA: Usa o cache lento (30s) ---
  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TIME_SLOW_MS)) {
    console.log('Hit no cache para: /post');
    return res.json(cachedData.data);
  }
  // --- FIM DA MUDANÇA ---
  try {
    // Esta query é o gargalo. 51k de posts é muito para enviar.
    const result = await pool.query('SELECT * FROM posts ORDER BY data_hora DESC');
    const data = result.rows;
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar todos os posts.' });
  }
});

// 4. GET /post/id/{id}
app.get('/post/id/:id', async (req, res) => {
  const { id } = req.params;

  // --- MUDANÇA: Validação de parâmetro ---
  if (isNaN(parseInt(id))) {
    return res.status(400).json({ error: 'ID deve ser um número.' });
  }
  // --- FIM DA MUDANÇA ---

  const cacheKey = `/post/id/${id}`;
  const cachedData = cache.get(cacheKey);
  // Usa o cache rápido
  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TIME_FAST_MS)) {
    console.log(`Hit no cache para: ${cacheKey}`);
    return res.json(cachedData.data);
  }
  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado.' });
    }
    const data = result.rows[0];
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar post por ID.' });
  }
});

// 5. GET /post/exp/{exp}
app.get('/post/exp/:exp', async (req, res) => {
  const { exp } = req.params;

  // --- MUDANÇA: Validação de parâmetro ---
  if (!exp || exp.trim() === '') {
    return res.status(400).json({ error: 'Expressão de busca não pode ser vazia.' });
  }
  // --- FIM DA MUDANÇA ---

  const cacheKey = `/post/exp/${exp}`;
  const cachedData = cache.get(cacheKey);
  // Usa o cache rápido
  if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TIME_FAST_MS)) {
    console.log(`Hit no cache para: ${cacheKey}`);
    return res.json(cachedData.data);
  }
  const tsQuery = exp.trim().split(/\s+/).join(' & ');
  const queryText = "SELECT * FROM posts WHERE to_tsvector('portuguese', comentario) @@ to_tsquery('portuguese', $1)";
  try {
    const result = await pool.query(queryText, [tsQuery]);
    const data = result.rows;
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    res.json(data);
  } catch (err) {
    // Trata erro de query de busca mal formatada
    if (err.code === '22P02' || err.code === '42601') {
      return res.status(400).json({ error: 'Expressão de busca mal formatada.'});
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar por expressão.' });
  }
});

// --- MUDANÇA: Removido o initializeDatabase() ---
// Apenas inicia o servidor
const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 8080;

app.listen(port, host, () => {
  console.log(`API Battle rodando publicamente em http://${host}:${port}`);
});
// --- FIM DA MUDANÇA ---