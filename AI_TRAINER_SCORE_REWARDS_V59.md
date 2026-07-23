# AI Trainer score rewards v59

Points are now calculated from the final average score, not from a flat case reward.

## Easy
- below 5.0: 0
- 5.0–5.9: 25
- 6.0–6.9: 50
- 7.0–7.9: 100
- 8.0–8.9: 150
- 9.0–10.0: 200

## Medium
- below 5.0: 0
- 5.0–5.9: 35
- 6.0–6.9: 80
- 7.0–7.9: 150
- 8.0–8.9: 200
- 9.0–10.0: 300

## Hard
- below 5.0: 0
- 5.0–5.9: 50
- 6.0–6.9: 125
- 7.0–7.9: 250
- 8.0–8.9: 400
- 9.0–10.0: 500

The backend is authoritative: it ignores points sent by the browser and recalculates them from score and verified scenario difficulty.
