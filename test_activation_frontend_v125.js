const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const app = read("frontend/src/App.js");
const goals = read("frontend/src/pages/Goals.jsx");
const home = read("frontend/src/pages/Home.jsx");
const admin = read("frontend/src/pages/Admin.jsx");
const pumb = read("frontend/src/pages/ActivationPumbGoals.jsx");
const cards = read("frontend/src/pages/ActivationCardsGoals.jsx");
const cache = read("frontend/src/lib/googleReportsCache.js");
const serviceWorker = read("frontend/public/service-worker.js");
const rootGateway = read("netlify/functions/google-goals.js");
const duplicateGateway = read("frontend/netlify/functions/google-goals.js");

assert(app.includes('path="/goals/activation/pumb"'), "PUMB Online route is missing");
assert(app.includes('path="/goals/activation/cards"'), "Card activation route is missing");
assert(goals.includes('["pumb_online", "cards"]'), "Activation profile must have exactly two goal metrics");
assert(goals.includes('reportProfile === "activation"'), "Goals page is not profile-aware");
assert(home.includes("mapActivationGoals"), "Home page does not map activation goals");
assert(home.includes("isActivationProfile"), "Home goal banner is not profile-aware");
assert(admin.includes('value="activation"'), "Admin activation profile option is missing");
assert(admin.includes('data-testid="user-edit-report-profile"'), "Admin edit profile selector is missing");
assert(pumb.includes('data-testid="activation-pumb-goals-page"'), "PUMB Online page is missing");
assert(cards.includes('data-testid="activation-cards-goals-page"'), "Card activation page is missing");
assert(cards.includes('key: "segment_a"'), "Segment A is missing");
assert(cards.includes('key: "segment_b"'), "Segment B is missing");
assert(cards.includes('key: "segment_c"'), "Segment C is missing");
assert(cards.includes('key: "segment_d"'), "Segment D is missing");
assert(cards.includes("Card activation giving"), "Card giving block is missing");
assert(pumb.includes("Pumb Online giving"), "PUMB giving block is missing");
assert(pumb.includes('data-testid="activation-report-access-denied"'), "PUMB sales-profile route guard is missing");
assert(cards.includes('data-testid="activation-report-access-denied"'), "Cards sales-profile route guard is missing");
assert(cache.includes('vpdk-google-reports-v128:'), "Frontend cache version is not v128");
assert(serviceWorker.includes('const VERSION = "vpdk-v128"'), "Service Worker version is not v128");
assert.strictEqual(rootGateway, duplicateGateway, "Gateway copies are out of sync");

console.log("Activation frontend v128: PASS");
