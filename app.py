import io
import json
import os
import random
import re
import sqlite3
import uuid
from datetime import datetime, timezone

import qrcode
from flask import Flask, jsonify, make_response, redirect, render_template, request, url_for
from openai import OpenAI
from PIL import Image
from wordcloud import STOPWORDS, WordCloud

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-secret-change-me")

DB_PATH = os.getenv("DB_PATH", "survey.db")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:5000")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")

PROMPT_TEMPLATE = """
You are a strict classifier for MBA classroom survey responses.

Task:
Classify the respondent's reason into one of:
1) loss_focus
2) expected_value_focus
3) mixed_or_other

Definitions:
- loss_focus: Mentions fear/impact of losses, downside pain, risk aversion, "100 is too much to lose", uncertainty discomfort.
- expected_value_focus: Mentions averages, long-run payoff, expected value, repeated-play logic, statistical advantage.
- mixed_or_other: Any mixed reasoning, unclear answer, emotional/noise, or neither category dominates.

Return JSON only:
{{
  "label": "loss_focus | expected_value_focus | mixed_or_other",
  "confidence": 0.0-1.0,
  "rationale": "short explanation in <= 20 words"
}}

Treatment: {treatment}
Q1 choice: {q1_choice}
Open text: {q2_text}
""".strip()


def db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_public_base_url():
    configured = os.getenv("PUBLIC_BASE_URL", "").strip()
    if configured:
        return configured.rstrip("/")
    return request.host_url.rstrip("/")


def init_db():
    with db_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                respondent_id TEXT NOT NULL UNIQUE,
                treatment TEXT NOT NULL CHECK (treatment IN ('T1', 'T2')),
                q1_choice TEXT NOT NULL CHECK (q1_choice IN ('accept', 'reject')),
                q2_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                reason_label TEXT,
                analysis_confidence REAL,
                analysis_rationale TEXT,
                analysis_source TEXT
            )
            """
        )
        conn.commit()


init_db()


def assign_treatment():
    return "T1" if random.random() < 0.5 else "T2"


def get_or_set_respondent():
    respondent_id = request.cookies.get("respondent_id")
    if not respondent_id:
        respondent_id = str(uuid.uuid4())
    return respondent_id


def get_treatment_from_cookie():
    value = request.cookies.get("treatment")
    if value in ("T1", "T2"):
        return value
    return assign_treatment()


def has_submitted(respondent_id):
    with db_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM responses WHERE respondent_id = ? LIMIT 1", (respondent_id,)
        ).fetchone()
    return row is not None


def classify_with_openai(treatment, q1_choice, q2_text):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return heuristic_classification(q2_text, "heuristic_no_key")

    client = OpenAI(api_key=api_key)
    prompt = PROMPT_TEMPLATE.format(
        treatment=treatment, q1_choice=q1_choice, q2_text=q2_text.strip()
    )

    try:
        response = client.responses.create(
            model=OPENAI_MODEL,
            input=[
                {
                    "role": "system",
                    "content": "You return strict JSON only, no markdown.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        text = response.output_text.strip()
    except Exception:
        return heuristic_classification(q2_text, "heuristic_api_error")

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            return heuristic_classification(q2_text, "heuristic_json_fallback")
        payload = json.loads(match.group(0))

    label = payload.get("label", "mixed_or_other")
    confidence = float(payload.get("confidence", 0.5))
    rationale = str(payload.get("rationale", "")).strip()[:200]

    if label not in ("loss_focus", "expected_value_focus", "mixed_or_other"):
        label = "mixed_or_other"

    return {
        "label": label,
        "confidence": max(0.0, min(1.0, confidence)),
        "rationale": rationale,
        "source": "openai",
    }


def heuristic_classification(text, source):
    t = text.lower()
    loss_hits = [
        "loss",
        "lose",
        "risk",
        "afraid",
        "fear",
        "too much",
        "downside",
        "pain",
        "safe",
    ]
    ev_hits = [
        "expected value",
        "average",
        "on average",
        "long run",
        "ten times",
        "10 times",
        "probability",
        "statistically",
    ]
    loss_score = sum(1 for w in loss_hits if w in t)
    ev_score = sum(1 for w in ev_hits if w in t)

    if loss_score > ev_score and loss_score >= 1:
        label = "loss_focus"
    elif ev_score > loss_score and ev_score >= 1:
        label = "expected_value_focus"
    else:
        label = "mixed_or_other"

    return {
        "label": label,
        "confidence": 0.6,
        "rationale": "Keyword fallback classifier",
        "source": source,
    }


def fetch_stats():
    with db_conn() as conn:
        total = conn.execute("SELECT COUNT(*) as c FROM responses").fetchone()["c"]

        t_rows = conn.execute(
            """
            SELECT treatment, q1_choice, COUNT(*) as c
            FROM responses
            GROUP BY treatment, q1_choice
            """
        ).fetchall()

        reason_rows = conn.execute(
            """
            SELECT COALESCE(reason_label, 'unclassified') as label, COUNT(*) as c
            FROM responses
            GROUP BY COALESCE(reason_label, 'unclassified')
            """
        ).fetchall()
        reason_treatment_rows = conn.execute(
            """
            SELECT treatment, COALESCE(reason_label, 'unclassified') as label, COUNT(*) as c
            FROM responses
            GROUP BY treatment, COALESCE(reason_label, 'unclassified')
            """
        ).fetchall()

        latest = conn.execute(
            """
            SELECT treatment, q1_choice, q2_text, reason_label, analysis_source, created_at
            FROM responses
            ORDER BY id DESC
            LIMIT 80
            """
        ).fetchall()

    treatment_counts = {
        "T1": {"accept": 0, "reject": 0},
        "T2": {"accept": 0, "reject": 0},
    }
    for r in t_rows:
        treatment_counts[r["treatment"]][r["q1_choice"]] = r["c"]

    reason_counts = {
        "loss_focus": 0,
        "expected_value_focus": 0,
        "mixed_or_other": 0,
        "unclassified": 0,
    }
    for r in reason_rows:
        reason_counts[r["label"]] = r["c"]

    reason_by_treatment = {
        "T1": {
            "loss_focus": 0,
            "expected_value_focus": 0,
            "mixed_or_other": 0,
            "unclassified": 0,
        },
        "T2": {
            "loss_focus": 0,
            "expected_value_focus": 0,
            "mixed_or_other": 0,
            "unclassified": 0,
        },
    }
    for r in reason_treatment_rows:
        reason_by_treatment[r["treatment"]][r["label"]] = r["c"]

    return {
        "total": total,
        "treatments": treatment_counts,
        "reason_labels": reason_counts,
        "reason_labels_by_treatment": reason_by_treatment,
        "latest_responses": [dict(x) for x in latest],
    }


@app.route("/")
def index():
    return redirect(url_for("survey"))


@app.route("/survey")
def survey():
    respondent_id = get_or_set_respondent()
    if has_submitted(respondent_id):
        return render_template("thanks.html")

    treatment = get_treatment_from_cookie()
    response = make_response(render_template("survey.html", treatment=treatment))
    response.set_cookie("respondent_id", respondent_id, max_age=60 * 60 * 6)
    response.set_cookie("treatment", treatment, max_age=60 * 60 * 6)
    return response


@app.post("/submit")
def submit():
    respondent_id = get_or_set_respondent()
    treatment = request.cookies.get("treatment", "T1")
    q1_choice = request.form.get("q1_choice")
    q2_text = (request.form.get("q2_text") or "").strip()

    if treatment not in ("T1", "T2"):
        treatment = assign_treatment()

    if q1_choice not in ("accept", "reject") or not q2_text:
        return "Invalid submission", 400

    created_at = datetime.now(timezone.utc).isoformat()
    with db_conn() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO responses
            (respondent_id, treatment, q1_choice, q2_text, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (respondent_id, treatment, q1_choice, q2_text, created_at),
        )
        conn.commit()
    return render_template("thanks.html")


@app.route("/teacher")
def teacher():
    return render_template("teacher.html", public_base_url=get_public_base_url())


@app.route("/api/stats")
def api_stats():
    return jsonify(fetch_stats())


@app.route("/api/prompt_template")
def api_prompt_template():
    return jsonify({"prompt_template": PROMPT_TEMPLATE})


@app.route("/api/wordcloud_data")
def api_wordcloud_data():
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT treatment, q2_text
            FROM responses
            ORDER BY id DESC
            LIMIT 1000
            """
        ).fetchall()

    grouped = {"T1": [], "T2": []}
    for row in rows:
        grouped[row["treatment"]].append(row["q2_text"])

    return jsonify(grouped)


@app.route("/api/wordcloud_image/<treatment>")
def api_wordcloud_image(treatment):
    if treatment not in ("T1", "T2"):
        return "Invalid treatment", 400

    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT q2_text
            FROM responses
            WHERE treatment = ?
            ORDER BY id DESC
            LIMIT 1000
            """,
            (treatment,),
        ).fetchall()

    text = " ".join([row["q2_text"] for row in rows]).strip()
    if not text:
        empty = Image.new("RGB", (900, 360), "white")
        buf = io.BytesIO()
        empty.save(buf, format="PNG")
        buf.seek(0)
        response = make_response(buf.getvalue())
        response.headers["Content-Type"] = "image/png"
        response.headers["Cache-Control"] = "no-store"
        return response

    base_stopwords = set(STOPWORDS)
    base_stopwords.update(
        {
            "would",
            "could",
            "also",
            "because",
            "really",
            "think",
            "choice",
            "choose",
            "gamble",
            "times",
            "accept",
            "reject",
            "single",
            "repeated",
            "trail",
            "trails",
            "t1",
            "t2",
            "q1",
            "q2",
            "play",
        }
    )

    palette = ["#0a113f", "#007f78", "#00a6a6", "#00a651", "#6e2436"]

    def color_func(word, font_size, position, orientation, random_state=None, **kwargs):
        return random.choice(palette)

    wc = WordCloud(
        width=900,
        height=360,
        background_color="white",
        stopwords=base_stopwords,
        max_words=120,
        collocations=False,
        prefer_horizontal=0.9,
        color_func=color_func,
        random_state=42,
    ).generate(text)

    img = wc.to_image()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    response = make_response(buf.getvalue())
    response.headers["Content-Type"] = "image/png"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/analyze_texts")
def api_analyze_texts():
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, treatment, q1_choice, q2_text
            FROM responses
            WHERE reason_label IS NULL
            ORDER BY id ASC
            """
        ).fetchall()

        analyzed = 0
        for row in rows:
            result = classify_with_openai(row["treatment"], row["q1_choice"], row["q2_text"])
            conn.execute(
                """
                UPDATE responses
                SET reason_label = ?, analysis_confidence = ?, analysis_rationale = ?, analysis_source = ?
                WHERE id = ?
                """,
                (
                    result["label"],
                    result["confidence"],
                    result["rationale"],
                    result["source"],
                    row["id"],
                ),
            )
            analyzed += 1
        conn.commit()

    return jsonify({"ok": True, "analyzed_count": analyzed})


@app.route("/api/qr")
def api_qr():
    survey_url = f"{get_public_base_url()}/survey"
    img = qrcode.make(survey_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    response = make_response(buf.getvalue())
    response.headers["Content-Type"] = "image/png"
    return response


@app.post("/api/reset")
def api_reset():
    with db_conn() as conn:
        conn.execute("DELETE FROM responses")
        conn.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
