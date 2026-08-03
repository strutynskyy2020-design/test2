const fs = require("fs");
const assert = require("assert");

const read = (path) => fs.readFileSync(path, "utf8");
const backend = read("backend/server.py");
const admin = read("frontend/src/pages/Admin.jsx");
const appContext = read("frontend/src/context/AppContext.jsx");
const reportsContext = read("frontend/src/context/GoogleReportsContext.jsx");
const reportsCache = read("frontend/src/lib/googleReportsCache.js");
const sw = read("frontend/public/service-worker.js");
const pwa = read("frontend/src/lib/pwa.js");

assert(backend.includes('class ReportProfileUpdateBody(BaseModel):'));
assert(backend.includes('@api.patch("/admin/users/{user_id}/report-profile"'));
assert(backend.includes('fresh.get("report_profile") != requested'));
assert(admin.includes('updatedUser?.report_profile !== requestedProfile'));
assert(admin.includes('Backend v126 ще не розгорнуто'));
assert(appContext.includes('applyFreshUser(data)'));
assert(appContext.includes('vpdk-report-access-changed'));
assert(reportsContext.includes('user.report_profile || "sales"'));
assert(reportsContext.includes('onReportAccessChanged'));
assert(reportsCache.includes('vpdk-google-reports-v126:'));
assert(reportsCache.includes('vpdk-google-reports-v125:'));
assert(sw.includes('const VERSION = "vpdk-v126"'));
assert(pwa.includes('/service-worker.js?v=126'));

console.log("v126 report-profile persistence checks passed");
