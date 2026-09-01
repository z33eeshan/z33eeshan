import { migrate, db } from "@/lib/db";
import { config } from "@/lib/config";

const ran = migrate(db());
if (ran.length === 0) {
  console.log(`Schema already current at ${config.databasePath}`);
} else {
  console.log(`Applied ${ran.length} migration(s): ${ran.join(", ")}`);
  console.log(`Database: ${config.databasePath}`);
}
