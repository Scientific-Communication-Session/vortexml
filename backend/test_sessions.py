"""
Background-session, queue and demo tests for VortexML.

Covers the pieces that let a training run outlive the browser tab that started
it: the sample-dataset loader, a real (tiny) run launched over HTTP, the
`/api/training/active` + attach/replay endpoints a returning browser uses, the
FIFO queue on the shared device (position, cancel, hand-off), cross-user
isolation of all of the above, predicting with the model a visitor just trained,
and the sales enquiry form. Runs offline against a throwaway SQLite database —
no network, no API key.

Run from the backend dir:   python test_sessions.py
"""

import os
import sys
import tempfile
import time

# Isolated SQLite DB so the test never touches a real database. Must be set
# before importing app (which reads the DB config at import time).
_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_TMPDB.close()
os.environ["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + _TMPDB.name
os.environ.setdefault("VORTEX_USE_SQLITE", "1")

from app import (app, db, socketio, limiter, _jobs, _queues, _recent_runs,   # noqa: E402
                 _thin_history, _HISTORY_REPLAY_MAX)
from models import Project, SalesInquiry                                     # noqa: E402
from training_engine import WEIGHTS_DIR                                      # noqa: E402

PASS, FAIL = "[ PASS ]", "[ FAIL ]"
_failures = 0
_weights = set()


def expect(cond, label):
    global _failures
    ok = bool(cond)
    if not ok:
        _failures += 1
    print(f"  {PASS if ok else FAIL} {label}")
    return ok


def _signup(email):
    c = app.test_client()
    r = c.post("/api/auth/signup", json={
        "email": email, "username": email.split("@")[0], "password": "test1234"})
    assert r.status_code == 201, f"signup failed: {r.status_code} {r.get_data(as_text=True)}"
    return c


def _wait(predicate, timeout=120.0):
    """Let the server's background greenlets run until `predicate()` holds."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        socketio.sleep(0.05)
    return predicate()


def _active(client):
    return client.get("/api/training/active").get_json()


def _load_demo(client, key, epochs=None):
    r = client.post("/api/demo/load", json={"key": key})
    assert r.status_code == 200, r.get_data(as_text=True)
    cfg = r.get_json()["config"]
    if epochs is not None:
        cfg = dict(cfg, epochs=epochs)
        r2 = client.post("/api/model/configure", json=cfg)
        assert r2.status_code == 200, r2.get_data(as_text=True)
    return r.get_json()


def _track_weights(client):
    run = _active(client).get("last_run") or {}
    wf = (run.get("final") or {}).get("weight_filename")
    if wf:
        _weights.add(wf)


def main():
    limiter.enabled = False  # the suite makes far more calls than a human would

    print("\nDemo datasets")
    anon = app.test_client()
    d = anon.get("/api/demo/datasets").get_json()["datasets"]
    keys = [x["key"] for x in d]
    expect({"iris", "breast_cancer", "diabetes", "student_performance"} <= set(keys),
           "all four sample datasets are listed")
    expect(all(x["available"] and x["rows"] > 0 and x["preview"] for x in d),
           "each one has real rows and a preview")
    iris = next(x for x in d if x["key"] == "iris")
    expect(iris["rows"] == 150 and iris["classes"] == {"setosa": 50, "versicolor": 50, "virginica": 50},
           "iris is the real 150-flower / 3-species dataset")
    r = anon.get("/api/demo/datasets/iris/download")
    expect(r.status_code == 200 and r.data.startswith(b"sepal_length_cm"), "sample CSV downloads")
    expect(anon.get("/api/demo/datasets/nope/download").status_code == 404, "unknown sample → 404")
    expect(anon.post("/api/demo/load", json={"key": "nope"}).status_code == 404, "loading unknown sample → 404")

    print("\nNo identity yet → no session minted by the status poll")
    fresh = app.test_client()
    r = fresh.get("/api/training/active")
    expect(r.get_json() == {"jobs": [], "last_run": None}, "active is empty for a brand-new visitor")
    expect("Set-Cookie" not in r.headers, "…and it does not hand out a session cookie")

    print("\nLoad without configuring (the tutorial path)")
    r = anon.post("/api/demo/load", json={"key": "student_performance", "configure": False}).get_json()
    st = anon.get("/api/state").get_json()
    expect(r["configured"] is False and st["has_dataset"] and not st["has_features"] and not st["has_model"],
           "dataset is loaded but columns/model are left to the user")

    print("\nA real run, started over HTTP, that nobody is watching")
    alice = _signup("alice.sessions@example.com")
    _load_demo(alice, "iris", epochs=4000)  # long enough to catch mid-flight
    r = alice.post("/api/training/start", json={})
    body = r.get_json()
    expect(r.status_code == 200 and body["status"] == "started", "run starts on the shared device")
    job_id = body["job_id"]
    act = _active(alice)
    expect(len(act["jobs"]) == 1 and act["jobs"][0]["status"] == "running"
           and act["jobs"][0]["job_id"] == job_id, "active reports it as running")
    expect(act["jobs"][0]["demo_key"] == "iris" and act["jobs"][0]["device_name"],
           "…with its device and dataset")

    # A second browser signed in to the same account sees the same run.
    alice2 = app.test_client()
    alice2.post("/api/auth/signin", json={"email": "alice.sessions@example.com", "password": "test1234"})
    expect([j["job_id"] for j in _active(alice2)["jobs"]] == [job_id],
           "another browser on the same account sees the run")

    expect(_wait(lambda: len(_jobs.get(job_id, {}).get("history", [])) >= 3),
           "the run makes progress with no client attached")
    snap = alice2.post(f"/api/training/jobs/{job_id}/attach", json={}).get_json()
    expect(snap["job"]["status"] == "running" and len(snap["history"]) >= 3
           and snap["info"] and snap["info"]["task_type"] == "classification",
           "attaching replays the model info and every epoch so far")
    expect([h["epoch"] for h in snap["history"]] == list(range(1, len(snap["history"]) + 1)),
           "replayed epochs are complete and in order")
    expect(snap["job"]["epoch"] == snap["history"][-1]["epoch"], "job progress tracks the latest epoch")

    print("\nIsolation")
    bob = _signup("bob.sessions@example.com")
    expect(_active(bob)["jobs"] == [], "another user does not see it")
    expect(bob.post(f"/api/training/jobs/{job_id}/attach", json={}).status_code == 404,
           "another user cannot attach to it")
    expect(bob.post("/api/training/stop", json={"job_id": job_id}).status_code == 403,
           "another user cannot stop it")
    bob.post("/api/training/stop", json={})
    before = len(_jobs[job_id]["history"]) if job_id in _jobs else -1
    expect(before >= 0 and _wait(lambda: len(_jobs.get(job_id, {}).get("history", [])) > before, 20),
           "a bare stop from another user leaves it running")

    print("\nStopping, then a run that completes while away")
    expect(alice2.post("/api/training/stop", json={"job_id": job_id}).status_code == 200,
           "the owner can stop it from a different browser")
    expect(_wait(lambda: job_id not in _jobs), "the device is released")
    act = _active(alice)
    expect(act["jobs"] == [] and act["last_run"]["job_id"] == job_id
           and act["last_run"]["status"] == "stopped", "the stopped run is recorded as stopped")
    expect(alice.get("/api/training/last-run/inference").get_json() == {"ready": False},
           "a stopped run offers no model to try")

    _load_demo(alice, "iris", epochs=12)
    job_id = alice.post("/api/training/start", json={}).get_json()["job_id"]
    expect(_wait(lambda: job_id not in _jobs), "a short run finishes")
    act = _active(alice)
    last = act["last_run"]
    expect(act["jobs"] == [] and last and last["job_id"] == job_id and last["status"] == "complete",
           "it becomes the account's last run")
    expect(last["final"].get("weight_filename") and "model_path" not in last["final"]
           and "history" not in last["final"], "outcome is kept, server paths are not")
    _weights.add(last["final"]["weight_filename"])
    snap = alice2.post(f"/api/training/jobs/{job_id}/attach", json={}).get_json()
    expect(snap["job"]["status"] == "complete" and len(snap["history"]) == 12 and snap["final"],
           "the finished run can still be replayed in full")
    with app.app_context():
        expect(Project.query.filter_by(weight_filename=last["final"]["weight_filename"]).count() == 1,
               "and it was saved to the account as a project")
    expect(bob.post(f"/api/training/jobs/{job_id}/attach", json={}).status_code == 404,
           "the finished run stays private")

    print("\nTry the model you just trained")
    inf = alice.get("/api/training/last-run/inference").get_json()
    expect(inf["ready"] and len(inf["fields"]) == 4 and len(inf["examples"]) == 12
           and inf["target_classes"] == ["setosa", "versicolor", "virginica"],
           "inference form + real example rows are offered")
    r = alice.post("/api/training/last-run/predict", json={"rows": inf["examples"]})
    pred = r.get_json()
    expect(r.status_code == 200 and pred["count"] == 12
           and pred["predictions"][0]["prediction"] in inf["target_classes"],
           "predictions come back labelled")
    expect(pred["evaluation"] and pred["evaluation"]["n"] == 12,
           "…and are scored against the true labels")
    expect(bob.get("/api/training/last-run/inference").get_json() == {"ready": False},
           "another user has no model to try")
    expect(bob.post("/api/training/last-run/predict", json={"rows": [{}]}).status_code == 409,
           "…and cannot predict with someone else's")

    print("\nQueue on the shared device")
    _load_demo(alice, "student_performance", epochs=4000)
    first = alice.post("/api/training/start", json={}).get_json()
    expect(first["status"] == "started", "first run takes the device")
    _load_demo(bob, "iris", epochs=5)
    second = bob.post("/api/training/start", json={}).get_json()
    expect(second["status"] == "queued" and second["position"] == 1 and second["ahead"] == 1,
           "a second user is queued behind it (1 ahead)")
    carol = app.test_client()  # anonymous visitor
    _load_demo(carol, "iris", epochs=5)
    third = carol.post("/api/training/start", json={}).get_json()
    expect(third["status"] == "queued" and third["position"] == 2 and third["ahead"] == 2,
           "a third (anonymous) run queues at position 2")
    dev = bob.get("/api/devices").get_json()["devices"][0]
    expect(dev["status"] == "busy" and dev["queue_length"] == 2, "device reports its queue length")
    expect([j["status"] for j in _active(bob)["jobs"]] == ["queued"], "queued run shows up in active")
    expect(bob.post(f"/api/training/jobs/{second['job_id']}/attach", json={}).get_json()["job"]["status"] == "queued",
           "a queued run can be attached to (to catch the hand-off)")
    expect(carol.delete(f"/api/training/queue/{second['job_id']}").status_code == 403,
           "you cannot cancel someone else's queued run")
    expect(bob.delete(f"/api/training/queue/{second['job_id']}").status_code == 200, "you can cancel your own")
    expect(_active(carol)["jobs"][0]["position"] == 1, "everyone behind moves up")
    expect(_active(bob)["jobs"] == [] and _active(bob)["last_run"] is None,
           "a run cancelled while queued leaves no 'last run'")

    expect(alice.post("/api/training/stop", json={"job_id": first["job_id"]}).status_code == 200,
           "owner stops the long run")
    expect(_wait(lambda: first["job_id"] not in _jobs), "the device is released")
    expect(_active(alice)["last_run"]["status"] == "stopped", "the stopped run is recorded as stopped")
    expect(_wait(lambda: not _queues.get(dev["id"]) and third["job_id"] not in _jobs),
           "the queued run is picked up and completes on its own")
    last = _active(carol)["last_run"]
    expect(last and last["job_id"] == third["job_id"] and last["status"] == "complete",
           "the anonymous visitor's run finished")
    _weights.add(last["final"]["weight_filename"])
    expect(carol.get("/api/training/last-run/inference").get_json()["ready"],
           "an anonymous visitor can try their model too")
    with app.app_context():
        expect(Project.query.filter_by(weight_filename=last["final"]["weight_filename"]).count() == 0,
               "anonymous runs are not saved as projects")

    print("\nLong histories are thinned for replay")
    long_history = [{"epoch": i} for i in range(1, 10001)]
    thin = _thin_history(long_history)
    expect(len(thin) <= _HISTORY_REPLAY_MAX + 1 and thin[0]["epoch"] == 1 and thin[-1]["epoch"] == 10000,
           "10,000 epochs → a bounded snapshot that keeps the first and last")

    print("\nSales enquiries")
    ok = {"name": "Ada", "email": "ada@example.com", "company": "Analytical Engines",
          "interest": "enterprise", "message": "We need to train several models in parallel."}
    expect(anon.post("/api/sales/contact", json=dict(ok, email="nope")).status_code == 400, "bad email rejected")
    expect(anon.post("/api/sales/contact", json=dict(ok, message="hi")).status_code == 400, "empty message rejected")
    expect(anon.post("/api/sales/contact", json=dict(ok, name=" ")).status_code == 400, "missing name rejected")
    r = alice.post("/api/sales/contact", json=ok)
    with app.app_context():
        row = SalesInquiry.query.get(r.get_json()["id"]) if r.status_code == 201 else None
        expect(row is not None and row.email == "ada@example.com" and row.user_id is not None,
               "valid enquiry is stored (linked to the signed-in account)")

    print()
    if _failures:
        print(f"{FAIL} {_failures} check(s) failed")
    else:
        print(f"{PASS} all session checks passed")
    return _failures


def _cleanup():
    for wf in _weights:
        for p in (os.path.join(WEIGHTS_DIR, wf),
                  os.path.join(WEIGHTS_DIR, wf[:-3] + ".preprocess.json")):
            if os.path.exists(p):
                os.remove(p)
    try:
        os.remove(_TMPDB.name)
    except OSError:
        pass


if __name__ == "__main__":
    try:
        rc = main()
    finally:
        _cleanup()
    sys.exit(1 if rc else 0)
