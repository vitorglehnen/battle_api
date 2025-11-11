// Arquivo: seed.js
// (Este código está correto, não precisa de mudança)

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

// Esta é a lista de *opções* de comentários
const comentarios = [
  'Ótimo post sobre Node.js!',
  'Adorei a dica de PostgreSQL.',
  'Essa API battle vai ser demais.',
  'Arquitetura de software é fundamental.',
  'Preciso otimizar minha query.',
  'O que acham de usar cache?',
  'Testando a busca por expressão.',
];
const autores = ['ana', 'bruno', 'carla', 'diego', 'elisa', 'fabio'];
const allTags = ['node', 'postgres', 'api', 'battle', 'performance', 'sql', 'express', 'dev', 'web'];


// Função para gerar um post aleatório
function gerarPost() {
  const quem = autores[Math.floor(Math.random() * autores.length)];
  
  // AQUI: 'comentario' recebe UMA string da lista
  const comentario = comentarios[Math.floor(Math.random() * comentarios.length)];

  const numTags = Math.floor(Math.random() * 4);
  const tags = [];
  for (let i = 0; i < numTags; i++) {
    tags.push(allTags[Math.floor(Math.random() * allTags.length)]);
  }
  const uniqueTags = [...new Set(tags)];

  // Retorna 'comentario' como string e 'tags' como array
  return { quem, comentario, tags: uniqueTags };
}

async function inserirEmLote(quantidade) {
  console.log(`Inserindo ${quantidade} posts...`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < quantidade; i++) {
      const { quem, comentario, tags } = gerarPost();
      await client.query(
        'INSERT INTO posts (quem, comentario, tags) VALUES ($1, $2, $3)',
        // 'comentario' (string) vai em $2
        // 'tags' (array) vai em $3
        [quem, comentario, tags]
      );
    }
    await client.query('COMMIT');
    console.log(`${quantidade} posts inseridos com sucesso.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro na inserção em lote:', err);
  } finally {
    client.release();
  }
}

async function carregarDados() {
  console.time('CargaTotal');
  const client = await pool.connect();
  console.log('Limpando tabela posts (TRUNCATE)...');
  await client.query('TRUNCATE TABLE posts RESTART IDENTITY');
  client.release();

  await inserirEmLote(1);
  await inserirEmLote(1000);
  await inserirEmLote(5000);
  await inserirEmLote(15000);
  await inserirEmLote(30000);
  
  console.log('Carga de dados finalizada. Total: 51001 posts.');
  console.timeEnd('CargaTotal');
  pool.end();
}

carregarDados();