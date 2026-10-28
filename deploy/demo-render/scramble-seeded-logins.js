// Kills every seeded login without pgcrypto. Unlike the installer, the users stay
// active so the admin keeps a full customer list to browse.
const { Client } = require('/app/node_modules/pg');

const seeded = `(SELECT id FROM "User" WHERE email LIKE '%@merchants.test'
  OR email LIKE '%@fixture.test' OR email LIKE 'customer%@test.com')`;

const sql = `
  DELETE FROM "Account" WHERE "providerId" = 'credential' AND "userId" IN ${seeded};
  UPDATE "User" SET "passwordHash" = md5(random()::text) || md5(clock_timestamp()::text)
    WHERE id IN ${seeded};
`;

const client = new Client({ connectionString: process.env.DATABASE_URL });
client
  .connect()
  .then(() => client.query(sql))
  .then(() => {
    console.log('[demo] seeded logins scrambled');
    return client.end();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
