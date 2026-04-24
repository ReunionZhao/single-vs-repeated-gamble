# Single vs Repeated Gamble - Live MBA Survey

Interactive classroom survey system with:
- Random treatment assignment (`T1` vs `T2`)
- Binary + open-text response collection
- Teacher live dashboard with charts
- QR code for instant student access
- One-click text analysis via OpenAI API (with fallback classifier)

## Quick Start

1. Create and activate virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Set environment variables:

```bash
cp .env.example .env
# then edit .env with your real OPENAI_API_KEY and public URL
```

3. Run:

```bash
source .venv/bin/activate
export $(grep -v '^#' .env | xargs)
python app.py
```

4. Open:
- Student survey: `http://localhost:5000/survey`
- Teacher dashboard: `http://localhost:5000/teacher`

## Deploy to Public Web (Render)

This app is ready to deploy as a web service so both links are public.

1. Push this project to GitHub.
2. In [Render](https://render.com), create a **Web Service** from your repo.
3. Use these settings:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn -w 2 -k gthread --threads 4 -b 0.0.0.0:$PORT app:app`
4. Add environment variables in Render:
   - `OPENAI_API_KEY` = your key
   - `OPENAI_MODEL` = `gpt-5.4-mini` (or your preferred model)
   - `FLASK_SECRET_KEY` = any random long string
   - `DB_PATH` = `/var/data/survey.db`
   - `PUBLIC_BASE_URL` = your Render URL (for example `https://your-app.onrender.com`)
5. (Recommended) attach a persistent disk in Render and mount to `/var/data`.
6. Deploy. Then use:
   - `https://your-app.onrender.com/survey`
   - `https://your-app.onrender.com/teacher`

Notes:
- QR code and Survey URL in teacher dashboard will use your deployed domain.
- If `PUBLIC_BASE_URL` is empty, the app auto-detects from current request host.

## OpenAI Classification Prompt (ready to use)

The app already embeds this template in `app.py` (`PROMPT_TEMPLATE`) and injects:
- treatment (`T1`/`T2`)
- Q1 choice (`accept`/`reject`)
- respondent open text

JSON output format:

```json
{
  "label": "loss_focus | expected_value_focus | mixed_or_other",
  "confidence": 0.0,
  "rationale": "short explanation"
}
```

Labels are stored with each response and visualized on the dashboard.
