const useSsl =
  typeof process.env.DATABASE_URL === "string" &&
  (process.env.DATABASE_URL.includes("sslmode=require") ||
    process.env.DATABASE_URL.includes("neon.tech"));

const shared = {
  use_env_variable: process.env.DATABASE_URL ? "DATABASE_URL" : undefined,
  dialect: "postgres",
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT || 5432,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD || undefined,
  database: process.env.DATABASE_NAME,
  ...(useSsl
    ? {
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        },
      }
    : {}),
};

module.exports = {
  development: shared,
  test: shared,
  "production-ssl-disabled": shared,
  production: {
    ...shared,
    dialectOptions: {
      ssl: {
        rejectUnauthorized: false,
      },
    },
  },
};
