import { randomBytes } from "node:crypto";
import path from "node:path";
import { openStore } from "../lib/store.js";
import { seedDemoAccounts } from "../lib/demo.js";
const args = process.argv.slice(2),
  index = args.indexOf("--database"),
  filename =
    index >= 0
      ? args[index + 1]
      : process.env.DATABASE_PATH || path.resolve("data/apexlinks.sqlite");
if (!filename) throw Error("Specify a database path.");
const generated = !process.env.DEMO_PASSWORD,
  password =
    process.env.DEMO_PASSWORD ||
    "ApexDemo-" + randomBytes(15).toString("base64url");
if (generated && !args.includes("--show-password"))
  throw Error(
    "Set DEMO_PASSWORD securely, or use --show-password to generate and display an initial test-only password.",
  );
const db = openStore(filename);
try {
  const result = seedDemoAccounts(db, password);
  console.log(
    "Demo workspaces prepared. Existing passwords are never reset by this command.",
  );
  for (const a of result.accounts)
    console.log(a.role.padEnd(8) + " " + a.email);
  if (result.disabled)
    console.log(
      "Demo accounts are disabled in this database. No accounts were changed.",
    );
  else if (generated && result.createdAccounts.length)
    console.log("Generated initial password (new accounts only): " + password);
  else if (generated)
    console.log(
      "Existing demo accounts retained their previous passwords; no new password was assigned.",
    );
  else
    console.log(
      "Initial demo password supplied securely; its value is not printed.",
    );
} finally {
  db.close();
}
