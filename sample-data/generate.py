"""
Generates a beginner-friendly student-performance dataset for VortexML.

Story: based on study habits, predict whether a student passes the exam.
This is a binary classification problem with a clear, learnable signal.
"""

import csv
import random
import math

random.seed(42)

N = 800

rows = []
for _ in range(N):
    hours_studied = round(random.uniform(0, 10), 2)
    previous_score = random.randint(40, 100)
    attendance_rate = round(random.uniform(0.4, 1.0), 2)
    sleep_hours = round(random.uniform(4, 9), 1)
    assignments_done = random.randint(0, 20)

    # Hidden formula that the model has to learn.
    # Weighted sum, then logistic squash + a bit of noise, then threshold.
    score = (
        0.30 * (hours_studied / 10) +
        0.30 * ((previous_score - 40) / 60) +
        0.20 * attendance_rate +
        0.10 * ((sleep_hours - 4) / 5) +
        0.10 * (assignments_done / 20)
    )
    # logistic squash to make it less linear
    prob_pass = 1 / (1 + math.exp(-(score - 0.55) * 8))
    # add a touch of noise so it isn't memorisable
    prob_pass += random.gauss(0, 0.05)
    passed = 1 if prob_pass > 0.5 else 0

    rows.append({
        "hours_studied": hours_studied,
        "previous_score": previous_score,
        "attendance_rate": attendance_rate,
        "sleep_hours": sleep_hours,
        "assignments_done": assignments_done,
        "passed": passed,
    })

out_path = "student_performance.csv"
with open(out_path, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)

pass_rate = sum(r["passed"] for r in rows) / len(rows)
print(f"Wrote {len(rows)} rows to {out_path}")
print(f"Class balance: passed={pass_rate:.1%}  failed={1-pass_rate:.1%}")
