# AI Trainer targeted update

## netlify/functions/ai-trainer.js
- Coach prompt now scores only the current sales stage.
- Discovery no longer penalizes missing product presentation before a need is found.
- Concrete product facts and objection answers receive a minimum relevant-dimension floor.
- Strong responses must add a new fact, question, check, or next step; a few-shot anti-paraphrase example was added.
- Actor prompt checks resolved objections and answered topics before every reply.
- Actor must close or decline after a resolved objection on later turns instead of inventing a new one.
- Character speech markers are now mandatory stylistic constraints.

## frontend/src/data/aiTrainerScenarios.js
- Expanded all 30 personas with distinct sentence length, tempo, formality, typical phrases, and verbal habits.

## frontend/src/pages/AITrainer.jsx
- Added delayed Android recognition restart after onend.
- Added interim-tail overlap preservation across recognition sessions.
- Enabled five alternatives and selects the highest-confidence transcript.
- Prevents late recognition callbacks from overwriting manual edits made after dictation stops.

## test_ai_trainer_logic.js
- Added static checks for new prompt rules, speech alternatives, delayed restart, and persona markers.
