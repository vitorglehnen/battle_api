const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const cache = new Map(); // --- MUDANÇA: Nosso cache em memória ---

// Este middleware vai rodar antes de CADA requisição
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

  // Nossas credenciais corretas (como no seu código)
  const expectedUser = 'adminho';
  const expectedPass = 'adminho';

  if (user === expectedUser && pass === expectedPass) {
    next();
  } else {
    res.set('WWW-Authenticate', 'Basic realm="API Battle - Acesso Restrito"');
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
};

// Middlewares padrões
app.use(express.json());

// Aplicar autenticação
app.use(basicAuthMiddleware);

// Pool de Conexão com o PostgreSQL
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
  const { quem, comentario, tags } = req.body;
  if (!quem || !comentario) {
    return res.status(400).json({ error: 'Campos "quem" e "comentario" são obrigatórios.' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO posts (quem, comentario, tags) VALUES ($1, $2, $3) RETURNING *',
      [quem, comentario, tags || []]
    );

    // --- MUDANÇA: Limpar o cache relevante ---
    // Se criamos um post, a contagem e a lista total mudaram.
    console.log('Cache limpo para /post/count e /post');
    cache.delete('/post/count');
    cache.delete('/post');
    // --- FIM DA MUDANÇA ---

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao inserir post.' });
  }
});

// 2. GET /post/count
app.get('/post/count', async (req, res) => {
  const cacheKey = '/post/count';

  // --- MUDANÇA: Checar o cache ---
  const cachedData = cache.get(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < 5000)) {
    console.log('Hit no cache para: /post/count');
    return res.json(cachedData.data);
  }
  // --- FIM DA MUDANÇA ---

  try {
    const result = await pool.query('SELECT COUNT(*) AS total FROM posts');
    
    // --- MUDANÇA: Salvar no cache ---
    const data = result.rows[0];
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    // --- FIM DA MUDANÇA ---
    
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao contar posts.' });
  }
});

// 3. GET /post
app.get('/post', async (req, res) => {
  const cacheKey = '/post';

  // --- MUDANÇA: Checar o cache ---
  const cachedData = cache.get(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < 5000)) {
    console.log('Hit no cache para: /post');
    return res.json(cachedData.data);
  }
  // --- FIM DA MUDANÇA ---

  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY data_hora DESC');
    
    // --- MUDANÇA: Salvar no cache ---
    const data = result.rows;
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    // --- FIM DA MUDANÇA ---

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar todos os posts.' });
  }
});

// 4. GET /post/id/{id}
app.get('/post/id/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `/post/id/${id}`; // Chave dinâmica

  // --- MUDANÇA: Checar o cache ---
  const cachedData = cache.get(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < 5000)) {
    console.log(`Hit no cache para: ${cacheKey}`);
    return res.json(cachedData.data);
  }
  // --- FIM DA MUDANÇA ---

  try {
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post não encontrado.' });
    }

    // --- MUDANÇA: Salvar no cache ---
    const data = result.rows[0];
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    // --- FIM DA MUDANÇA ---

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar post por ID.' });
  }
});

// 5. GET /post/exp/{exp}
app.get('/post/exp/:exp', async (req, res) => {
  const { exp } = req.params;
  const cacheKey = `/post/exp/${exp}`; // Chave dinâmica

  // --- MUDANÇA: Checar o cache ---
  const cachedData = cache.get(cacheKey);
  if (cachedData && (Date.now() - cachedData.timestamp < 5000)) {
    console.log(`Hit no cache para: ${cacheKey}`);
    return res.json(cachedData.data);
  }
  // --- FIM DA MUDANÇA ---

  const tsQuery = exp.trim().split(/\s+/).join(' & ');
  const queryText = "SELECT * FROM posts WHERE to_tsvector('portuguese', comentario) @@ to_tsquery('portuguese', $1)";
  
  try {
    const result = await pool.query(queryText, [tsQuery]);
    
    // --- MUDANÇA: Salvar no cache ---
    const data = result.rows;
    cache.set(cacheKey, { data: data, timestamp: Date.now() });
    // --- FIM DA MUDANÇA ---
    
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar por expressão.' });
  }
});

async function initializeDatabase() {
  console.log('Verificando e inicializando o banco de dados...');
  const query = `
    CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        quem VARCHAR(255) NOT NULL,
        data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        comentario TEXT,
        tags TEXT[] DEFAULT ARRAY[]::TEXT[]
    );
    CREATE INDEX IF NOT EXISTS idx_posts_comentario_gin ON posts USING GIN (to_tsvector('portuguese', comentario));
    CREATE INDEX IF NOT EXISTS idx_posts_tags_gin ON posts USING GIN (tags);
  `;
  try {
    const client = await pool.connect();
    await client.query(query);
    client.release();
    console.log('Banco de dados verificado e pronto para uso.');
  } catch (err) {
    console.error('ERRO AO INICIALIZAR O BANCO DE DADOS:', err);
    process.exit(1);
  }
}

async function startServer() {

  // Lê as novas variáveis do .env
  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.PORT || 8080;

  // Inicia o servidor ouvindo no host e porta definidos
  app.listen(port, host, () => {
    console.log(`API Battle rodando publicamente em http://${host}:${port}`);
  });
}

startServer();