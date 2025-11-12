DROP TABLE IF EXISTS posts;

    CREATE TABLE posts (
        id SERIAL PRIMARY KEY,
        quem VARCHAR(255) NOT NULL,
        data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        comentario TEXT,
        tags TEXT[] DEFAULT ARRAY[]::TEXT[]
    );

CREATE INDEX idx_posts_comentario_gin ON posts USING GIN (to_tsvector('portuguese', comentario));
CREATE INDEX idx_posts_tags_gin ON posts USING GIN (tags);