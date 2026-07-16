const fs = require('fs');
const source = fs.readFileSync('netlify/functions/ai-trainer.js', 'utf8');
const required = [
  'stageWeights',
  'resolved_objections',
  'answered_topics',
  'Номер ходу',
  'strong_response відрізняється від відповіді оператора лише синонімами',
  'На 7+ ході',
  'active_objections порожній',
  'жоден релевантний вимір не може бути нижче 7',
];
for (const token of required) {
  if (!source.includes(token)) throw new Error(`Missing trainer rule: ${token}`);
}
const ui = fs.readFileSync('frontend/src/pages/AITrainer.jsx', 'utf8');
if (!ui.includes('turnNumber:scores.length+1')) throw new Error('Frontend does not send turn number');
if (!ui.includes('result.outcome==="deal"')) throw new Error('Frontend does not finish immediately on deal');
if (!ui.includes('mergeRecognitionChunks')) throw new Error('Microphone cumulative-result fix missing');
if (!ui.includes('r.maxAlternatives=5')) throw new Error('Speech alternatives are not enabled');
if (!ui.includes('setTimeout(()=>')) throw new Error('Delayed Android recognition restart missing');
const scenarios = fs.readFileSync('frontend/src/data/aiTrainerScenarios.js', 'utf8');
if ((scenarios.match(/на «ви»/g) || []).length < 30) throw new Error('Persona speech markers are incomplete');
console.log('AI trainer static checks: PASS');

const { _test } = require('./netlify/functions/ai-trainer.js');
const safePhrases = [
  'фінанси люблять точність',
  'небанківський продукт',
  'полюбляю свою роботу',
  "об'єднаний рахунок",
  'запізнення платежу',
  'поїзд',
];
for (const phrase of safePhrases) {
  const result = _test.localSafetyCheck(phrase);
  if (result?.severity === 'terminal') throw new Error(`False profanity positive: ${phrase}`);
}
for (const phrase of ['бляха', 'блядь', 'їбать']) {
  const result = _test.localSafetyCheck(phrase);
  if (result?.severity !== 'terminal') throw new Error(`Profanity was not detected: ${phrase}`);
}
if (_test.recentClientDeferStreak([
  { role: 'client', text: 'Добре, подивлюсь і зателефоную пізніше' },
  { role: 'operator', text: 'Можу ще щось уточнити?' },
  { role: 'client', text: 'Гаразд, я подумаю і передзвоню потім' },
]) !== 2) throw new Error('Client defer streak is calculated incorrectly');
if (!source.includes('previous_feedback')) throw new Error('Previous coach feedback is not included');
if (!source.includes('deferStreak >= 3')) throw new Error('Hard deferral loop stop is missing');
console.log('AI trainer safety and loop checks: PASS');
