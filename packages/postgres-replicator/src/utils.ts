import { getEnv, strictParseInt, tryGetEnv } from "@dataland-io/dataland-sdk";
import { Client } from "@dataland-workerlibs/postgres";

export const getPgSchema = (): string => {
  const pgSchema = tryGetEnv("PG_SCHEMA");
  if (pgSchema == null) {
    return "public";
  }
  validatePgIdentifier(pgSchema);
  return pgSchema;
};

const validatePgIdentifier = (identifier: string) => {
  // We allow every character except double quotes, because we will always quote the identifiers
  // when constructing queries.
  //
  // From https://www.postgresql.org/docs/current/sql-syntax-lexical.html:
  // Quoted identifiers can contain any character, except the character with code zero.
  // This allows constructing table or column names that would otherwise not be possible,
  // such as ones containing spaces or ampersands. The length limitation still applies.
  if (identifier.includes(`"`)) {
    throw new Error(
      `Invalid Postgres identifier - contains double-quote character - ${identifier}`
    );
  }
  if (identifier.length > 63) {
    throw new Error(`Invalid Postgres identifier - too long - ${identifier}`);
  }
};

export const getClient = () => {
  const pgHost = getEnv("PG_HOST");
  const pgPort = (() => {
    const str = tryGetEnv("PG_PORT");
    if (str == null) {
      return 6543;
    }
    const int = strictParseInt(str);
    if (int == null) {
      throw new Error(`invalid PG_PORT - ${str}`);
    }
    return int;
  })();
  const pgDatabase = tryGetEnv("PG_DATABASE") ?? "postgres";
  const pgUser = tryGetEnv("PG_USER") ?? "postgres";
  const pgPassword = getEnv("PG_PASSWORD");

  const client = new Client({
    hostname: pgHost,
    port: pgPort,
    database: pgDatabase,
    user: pgUser,
    password: pgPassword,
    tls: {
      enabled: false,
      // enforce: false,
      // caCertificates: [],
    },
    connection: {
      attempts: 5,
    },
  });
  return client;
};
