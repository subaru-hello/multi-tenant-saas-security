import fs from "node:fs";
import path from "node:path";

import { createApp } from "./app.js";
import { createDatabase } from "./database.js";

const port = Number(process.env.PORT ?? 3000);
const dataDirectory = path.join(process.cwd(), "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = createDatabase(path.join(dataDirectory, "demo.db"));
const app = createApp(db);

app.listen(port, () => {
  console.log(`TenantInvariant SaaS Lab: http://localhost:${port}`);
});
