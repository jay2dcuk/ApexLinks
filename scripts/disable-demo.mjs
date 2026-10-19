import path from "node:path";
import { openStore } from "../lib/store.js";
import { disableDemoAccounts } from "../lib/demo.js";
const db = openStore(
  process.env.DATABASE_PATH || path.resolve("data/apexlinks.sqlite"),
);
try {
  console.log(
    `Disabled ${disableDemoAccounts(db)} demo accounts, revoked their sessions, and removed their organisation access. Club records were retained.`,
  );
} finally {
  db.close();
}
