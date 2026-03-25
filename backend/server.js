const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

let PORT = parseInt(process.env.PORT || "3000", 10);
let DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/aik_tasks";
let ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";
let SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || "aik-tasks-dev-session-secret";

const rootDir = path.resolve(__dirname, "..");
const indexPath = path.join(rootDir, "index.html");
const readmePath = path.join(rootDir, "README.md");
const tasksPath = path.join(__dirname, "data", "tasks.json");

const phaseNames = {
  1: "Phase 1 - Foundation",
  2: "Phase 2 - C Fundamentals",
  3: "Phase 3 - Python Foundations",
  4: "Phase 4 - Networking",
  5: "Phase 5 - Workflow & Tools",
  6: "Phase 6 - AI Foundations",
  7: "Phase 7 - Databases",
  8: "Phase 8 - Projects & Cloud",
  9: "Phase 9 - C Deep Dives",
  10: "Phase 10 - Linux Internals",
  11: "Phase 11 - Networking Deep Dives",
  12: "Phase 12 - Hardware Basics",
  13: "Phase 13 - Modern Tech Topics"
};

const categoryKeys = new Set([
  "systems",
  "c",
  "python",
  "networking",
  "tools",
  "ai",
  "db"
]);

const priorityKeys = new Set(["foundation", "core", "advanced", "project"]);

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
PORT = parseInt(process.env.PORT || String(PORT), 10);
DATABASE_URL = process.env.DATABASE_URL || DATABASE_URL;
ADMIN_USERNAME = process.env.ADMIN_USERNAME || ADMIN_USERNAME;
ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD;
SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || SESSION_SECRET;

const pool = new Pool({
  connectionString: DATABASE_URL
});
let dbReady = false;
let dbInitError = "";

pool.on("error", (error) => {
  dbReady = false;
  dbInitError = error.message;
  console.error("PostgreSQL pool error:", error.message);
});

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function parseJsonBody(raw) {
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signToken(payload) {
  const payloadText = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(payloadText);
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${encodedPayload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  const expectedSignature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(encodedPayload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function normalizeTask(input) {
  const title = String(input.title || "").trim();
  const concept = String(input.concept || "").trim();
  const phaseIdx = Number.parseInt(String(input.phaseIdx || ""), 10);
  const cat = String(input.cat || "").trim();
  const prio = String(input.prio || "").trim();
  const phase = String(input.phase || phaseNames[phaseIdx] || `Phase ${phaseIdx}`).trim();

  if (!title) {
    throw new Error("Title is required");
  }
  if (!concept) {
    throw new Error("Concept is required");
  }
  if (!Number.isInteger(phaseIdx) || phaseIdx < 1) {
    throw new Error("Phase index must be a positive integer");
  }
  if (!categoryKeys.has(cat)) {
    throw new Error("Category is invalid");
  }
  if (!priorityKeys.has(prio)) {
    throw new Error("Priority is invalid");
  }

  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
    : [];
  const howto = Array.isArray(input.howto)
    ? input.howto.map((step) => String(step).trim()).filter(Boolean).slice(0, 12)
    : [];

  if (howto.length === 0) {
    throw new Error("Add at least one step");
  }

  const preferredOrder = Number.parseInt(String(input.order || ""), 10);

  return {
    title,
    concept,
    phaseIdx,
    cat,
    prio,
    phase,
    tags,
    howto,
    preferredOrder: Number.isInteger(preferredOrder) && preferredOrder > 0 ? preferredOrder : null
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_index INTEGER NOT NULL,
      phase TEXT NOT NULL,
      phase_idx INTEGER NOT NULL,
      cat TEXT NOT NULL,
      prio TEXT NOT NULL,
      title TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      concept TEXT NOT NULL,
      howto JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS tasks_phase_order_idx
    ON tasks (phase_idx, order_index, id)
  `);
}

function readLegacyTasks() {
  if (!fs.existsSync(tasksPath)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch (error) {
    console.error("Failed to read legacy tasks.json:", error.message);
    return [];
  }
}

function mapTaskRow(row) {
  return {
    id: row.id,
    order: row.order_index,
    phase: row.phase,
    phaseIdx: row.phase_idx,
    cat: row.cat,
    prio: row.prio,
    title: row.title,
    tags: Array.isArray(row.tags) ? row.tags : [],
    concept: row.concept,
    howto: Array.isArray(row.howto) ? row.howto : [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function getStoredTasks() {
  const result = await pool.query(`
    SELECT id, order_index, phase, phase_idx, cat, prio, title, tags, concept, howto, created_at
    FROM tasks
    ORDER BY phase_idx ASC, order_index ASC, id ASC
  `);
  return result.rows.map(mapTaskRow);
}

async function insertTask(task) {
  const result = await pool.query(
    `
      INSERT INTO tasks (order_index, phase, phase_idx, cat, prio, title, tags, concept, howto)
      VALUES (
        COALESCE(
          $1,
          (SELECT COALESCE(MAX(order_index), 0) + 1 FROM tasks WHERE phase_idx = $2)
        ),
        $3,
        $2,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9::jsonb
      )
      RETURNING id, order_index, phase, phase_idx, cat, prio, title, tags, concept, howto, created_at
    `,
    [
      task.preferredOrder,
      task.phaseIdx,
      task.phase,
      task.cat,
      task.prio,
      task.title,
      JSON.stringify(task.tags),
      task.concept,
      JSON.stringify(task.howto)
    ]
  );

  return mapTaskRow(result.rows[0]);
}

async function migrateLegacyTasksIfNeeded() {
  const legacyTasks = readLegacyTasks();
  if (legacyTasks.length === 0) {
    return;
  }

  const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM tasks");
  if (countResult.rows[0].count > 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const legacyTask of legacyTasks) {
      const phaseIdx = Number.isInteger(legacyTask.phaseIdx) && legacyTask.phaseIdx > 0 ? legacyTask.phaseIdx : 1;
      await client.query(
        `
          INSERT INTO tasks (order_index, phase, phase_idx, cat, prio, title, tags, concept, howto, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, COALESCE($10::timestamptz, NOW()))
        `,
        [
          Number.isInteger(legacyTask.order) && legacyTask.order > 0 ? legacyTask.order : 1,
          String(legacyTask.phase || phaseNames[phaseIdx] || `Phase ${phaseIdx}`),
          phaseIdx,
          categoryKeys.has(String(legacyTask.cat || "").trim()) ? String(legacyTask.cat).trim() : "systems",
          priorityKeys.has(String(legacyTask.prio || "").trim()) ? String(legacyTask.prio).trim() : "foundation",
          String(legacyTask.title || "Untitled task").trim() || "Untitled task",
          JSON.stringify(
            Array.isArray(legacyTask.tags)
              ? legacyTask.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12)
              : []
          ),
          String(legacyTask.concept || "").trim(),
          JSON.stringify(
            Array.isArray(legacyTask.howto)
              ? legacyTask.howto.map((step) => String(step).trim()).filter(Boolean).slice(0, 12)
              : []
          ),
          legacyTask.createdAt || null
        ]
      );
    }
    await client.query("COMMIT");
    console.log(`Imported ${legacyTasks.length} legacy tasks from backend/data/tasks.json`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function getDbStatus() {
  if (dbReady) {
    return { ok: true, db: "up" };
  }

  return {
    ok: false,
    db: "down",
    error: dbInitError || "Database is not ready"
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    const status = getDbStatus();
    return json(res, status.ok ? 200 : 503, status);
  }

  if (req.method === "GET" && pathname === "/api/tasks") {
    if (!dbReady) {
      return json(res, 503, { error: "Database unavailable", detail: dbInitError || "Database is not ready" });
    }

    try {
      const tasks = await getStoredTasks();
      return json(res, 200, { tasks });
    } catch (error) {
      return json(res, 500, { error: "Failed to load tasks", detail: error.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    let body;
    try {
      body = parseJsonBody(await readBody(req));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    if (body.username !== ADMIN_USERNAME || body.password !== ADMIN_PASSWORD) {
      return json(res, 401, { error: "Invalid admin credentials" });
    }

    const token = signToken({
      sub: ADMIN_USERNAME,
      exp: Date.now() + 1000 * 60 * 60 * 12
    });
    return json(res, 200, { token, username: ADMIN_USERNAME });
  }

  if (req.method === "POST" && pathname === "/api/admin/tasks") {
    if (!dbReady) {
      return json(res, 503, { error: "Database unavailable", detail: dbInitError || "Database is not ready" });
    }

    const token = getBearerToken(req);
    const session = verifyToken(token);
    if (!session) {
      return json(res, 401, { error: "Unauthorized" });
    }

    let body;
    try {
      body = parseJsonBody(await readBody(req));
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    let task;
    try {
      task = normalizeTask(body);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    try {
      const createdTask = await insertTask(task);
      return json(res, 201, { task: createdTask });
    } catch (error) {
      return json(res, 500, { error: "Failed to store task", detail: error.message });
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, pathname);
    if (handled !== false) {
      return;
    }
    return json(res, 404, { error: "Not found" });
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed" });
  }

  if (pathname === "/" || pathname === "/index.html") {
    return text(res, 200, fs.readFileSync(indexPath, "utf8"), "text/html; charset=utf-8");
  }

  if (pathname === "/README.md") {
    return text(res, 200, fs.readFileSync(readmePath, "utf8"), "text/markdown; charset=utf-8");
  }

  return text(res, 404, "Not found");
});

async function start() {
  server.listen(PORT, () => {
    console.log(`AIK Tasks backend running at http://localhost:${PORT}`);
  });

  try {
    await initDb();
    await migrateLegacyTasksIfNeeded();
    dbReady = true;
    dbInitError = "";
    console.log("PostgreSQL storage ready");
  } catch (error) {
    dbReady = false;
    dbInitError = error.message;
    console.error("PostgreSQL storage unavailable:", error.message);
  }
}

start().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exit(1);
});
