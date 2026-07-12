import {
  configureTestDatabaseUrl,
  provisionIsolatedTestDatabase,
} from "./test-database.js";

export default async function setup() {
  await configureTestDatabaseUrl();
  return provisionIsolatedTestDatabase();
}
