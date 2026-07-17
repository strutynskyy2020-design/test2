const fs = require("fs");
const assert = require("assert");

const backend = fs.readFileSync("backend/server.py", "utf8");
const admin = fs.readFileSync("frontend/src/pages/Admin.jsx", "utf8");
const goals = fs.readFileSync("frontend/src/pages/Goals.jsx", "utf8");
const fn = fs.readFileSync("netlify/functions/google-goals.js", "utf8");
const appsScript = fs.readFileSync("integrations/google-sheets/Code.gs", "utf8");

assert(backend.includes("goals_login: Optional[str] = None"));
assert(backend.includes('updates["goals_login"] = normalized_goals_login or None'));
assert(backend.includes("Цей ключ Google цілей уже використовується"));
assert(admin.includes('data-testid="user-edit-goals-login"'));
assert(goals.includes('fetch("/.netlify/functions/google-goals"'));
assert(fn.includes("user.goals_login"));
assert(fn.includes('url.searchParams.set("goals_login", goalsLogin)'));
assert(appsScript.includes('headers.indexOf("goals_login")'));
console.log("Google goals integration checks: PASS");
