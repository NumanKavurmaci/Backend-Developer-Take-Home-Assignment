import {
  configureTestDatabaseUrl,
  recreateTestDatabase,
  removeTestDatabase,
} from "./test-database.js";

export default async function setup() {
  await configureTestDatabaseUrl();
  await recreateTestDatabase();

  return async () => {
    await removeTestDatabase();
  };
}
