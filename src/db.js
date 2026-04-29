import { Pool } from 'pg';

const createDatabase = (config) => {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl || false,
  });

  const getClient_ = async (pool) => {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;
    const timeout = setTimeout(() => {
      console.error('A client has been checked out for more than 5 seconds!');
      console.error(
        `The last executed query on this client was: ${client.lastQuery}`
      );
    }, 5000);
    client.query = (...args) => {
      client.lastQuery = args;
      return query.apply(client, args);
    };
    client.release = () => {
      clearTimeout(timeout);
      client.query = query;
      client.release = release;
      return release.apply(client);
    };
    return client;
  };

  return {
    query: async (text, params) => {
      try {
        const res = await pool.query(text, params);
        return res;
      } catch (err) {
        err.type = 'POSTGRESQL_ERROR';
        throw err;
      }
    },

    getClient: async () => {
      return getClient_(pool);
    },

    pool,
  };
};

const authDb = createDatabase({
  host: process.env.AUTH_POSTGRES_HOST || "localhost",
  port: process.env.AUTH_POSTGRES_PORT || "5432",
  database: process.env.AUTH_POSTGRES_DB || "mydatabase",
  user: process.env.AUTH_POSTGRES_USER || "myuser",
  password: process.env.AUTH_POSTGRES_PASSWORD || "mypassword",
  ssl: "no-verify",
});

const voucherDb = createDatabase({
  host: process.env.NAWGATI_POSTGRES_HOST,
  port: process.env.NAWGATI_POSTGRES_PORT,
  database: process.env.NAWGATI_POSTGRES_DB,
  user: process.env.NAWGATI_POSTGRES_USER,
  password: process.env.NAWGATI_POSTGRES_PASSWORD,
  ssl: "no-verify",
});

export const db = authDb;

const _origQuery = authDb.pool.query.bind(authDb.pool);
authDb.pool.query = (...args) => {
  const [text, params] = args;
  console.log("[pg auth] SQL:", typeof text === "string" ? text : text?.text);
  if (params) console.log("[pg auth] params:", params);
  return _origQuery(...args);
};
export const pool = authDb.pool;

export { authDb, voucherDb };
