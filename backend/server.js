const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let PORT = parseInt(process.env.PORT || "3000", 10);
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
ADMIN_USERNAME = process.env.ADMIN_USERNAME || ADMIN_USERNAME;
ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ADMIN_PASSWORD;
SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || SESSION_SECRET;

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

function readStoredTasks() {
  if (!fs.existsSync(tasksPath)) {
    return { tasks: [] };
  }

  try {
    const data = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
    return {
      tasks: Array.isArray(data.tasks) ? data.tasks : []
    };
  } catch (error) {
    return { tasks: [] };
  }
}

function writeStoredTasks(tasks) {
  fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
  fs.writeFileSync(tasksPath, JSON.stringify({ tasks }, null, 2) + "\n", "utf8");
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

function nextTaskId(tasks) {
  const maxId = tasks.reduce((max, task) => {
    return Number.isInteger(task.id) && task.id > max ? task.id : max;
  }, 10000);
  return maxId + 1;
}

function nextTaskOrder(tasks, phaseIdx) {
  const inPhase = tasks.filter((task) => Number(task.phaseIdx) === Number(phaseIdx));
  const maxOrder = inPhase.reduce((max, task) => {
    return Number.isInteger(task.order) && task.order > max ? task.order : max;
  }, 0);
  return maxOrder + 1;
}

function normalizeTask(input, existingTasks) {
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
  const order = Number.isInteger(preferredOrder) && preferredOrder > 0
    ? preferredOrder
    : nextTaskOrder(existingTasks, phaseIdx);

  return {
    id: nextTaskId(existingTasks),
    order,
    phase,
    phaseIdx,
    cat,
    prio,
    title,
    tags,
    concept,
    howto,
    createdAt: new Date().toISOString()
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/tasks") {
    const data = readStoredTasks();
    return json(res, 200, { tasks: data.tasks });
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

    const data = readStoredTasks();
    let task;
    try {
      task = normalizeTask(body, data.tasks);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }

    data.tasks.push(task);
    writeStoredTasks(data.tasks);
    return json(res, 201, { task });
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

server.listen(PORT, () => {
  console.log(`AIK Tasks backend running at http://localhost:${PORT}`);
});

