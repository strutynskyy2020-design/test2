from pathlib import Path

ROOT = Path(__file__).resolve().parent
cards = (ROOT / "frontend/src/pages/ActivationCardsGoals.jsx").read_text(encoding="utf-8")
cache = (ROOT / "frontend/src/lib/googleReportsCache.js").read_text(encoding="utf-8")
sw = (ROOT / "frontend/public/service-worker.js").read_text(encoding="utf-8")
script = (ROOT / "integrations/google-sheets/Code.gs").read_text(encoding="utf-8")

# The five transformation cards compare against the project-wide overall column.
assert 'function MetricCard({ metric, own, project })' in cards
assert '>Проект</span>' in cards
assert 'project={firstReportValue(active?.[`${metric.key}_overall`], projectMetrics?.[metric.key])}' in cards
assert 'report?.activation_cards_transformation_group_summaries?.[period]' in cards
assert 'return summaries?.general || summaries?.overall || null;' in cards

# No team fallback may be used by the transformation MetricCard call.
metric_section = cards[cards.index('{active ? <section'):cards.index('</section> : <section', cards.index('{active ? <section'))]
assert 'team={active?.[' not in metric_section
assert 'team_summary?.[metric.key]' not in metric_section
assert 'teamMetrics?.[metric.key]' not in metric_section

# The upper projection block and giving segments intentionally remain team-scoped.
assert '>Команда</div><div className="mt-1 text-xl font-black text-white">{formatPercent(projectionTeam?.projective_rate)}' in cards
assert 'команда {formatCount(teamGivingValue, "—")}' in cards
assert '<span className="uppercase tracking-wider text-zinc-600">Команда</span>' in cards

# Apps Script already emits per-row *_overall values from the general summary column.
assert 'outputs[columnIndex][`${metricKey}_overall`] = overall;' in script
assert 'groupSummaries[period].general' in script

# Browser cache is bumped so the changed UI is loaded after deployment.
assert 'vpdk-google-reports-v132:' in cache
assert 'vpdk-google-reports-v132' in cache
assert 'vpdk-google-reports-v131:' in cache
assert 'const VERSION = "vpdk-v132"' in sw

print("VPDK Bonus v132 validation: PASS")
