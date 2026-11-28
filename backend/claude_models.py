"""
Which Claude models VortexML uses, and the one place it calls them.

The rest of the backend names a *family* — "sonnet" for the tutor, the
co-pilot's questions and Explain Results; "opus" for the co-pilot's decision and
as the default of the Assistant and Chat — and this module turns that into the
newest model of the family the API key can use. The answer comes from the
Models API when the server starts and again every few hours (`refresh`), so a
newly released Opus or Sonnet is picked up without a code change.

Newer is not always compatible: each generation so far has dropped a request
option the one before accepted. So a request is sent to the newest model first
and, if that model turns it down as malformed, to `PINNED` — the generation
this code was written and tested against. What was turned down is remembered
(until the next refresh) so the detour is taken once, not on every request.

Every function that sends a request waits on the network. The server is a
single event loop: call them through `_run_blocking` / `_iter_blocking` in
app.py, never directly from a handler.
"""

import logging
import re
import threading

import anthropic

logger = logging.getLogger("vortex.claude")

# The generation the requests in this app are known to work with. Used until
# the Models API has answered, when it cannot be reached, and when a newer
# model rejects a request. Move these forward after testing a new generation.
PINNED = {"opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5-5"}
NAMES = {"claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5"}

REFRESH_SECONDS = 6 * 3600

# Shown in place of an answer when the model's safety checks decline a request
# (that arrives as a normal response with `stop_reason: "refusal"` and no text).
DECLINED = ("I can't help with that request. Try putting it another way, or ask "
            "about your data, your model or your training run.")

# If a safety check declines a request, have the API retry it on the model
# Anthropic recommends for that case instead of returning nothing. An ML tutor
# talks about training models all day; this keeps a false alarm from becoming
# an empty answer. (A beta: requests fall back to the plain call without it.)
_REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01"

# `claude-opus-5-5`, `claude-sonnet-5`, `claude-opus-4-5-20251101`: family,
# major, optional minor, optional snapshot date. Anything else (previews,
# other families) is never chosen automatically.
_RELEASE = re.compile(r"^claude-(opus|sonnet)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$")
_FAMILY = re.compile(r"^claude-(opus|sonnet)-")

# "The request or the model is wrong", as opposed to "try again later".
REJECTED = (anthropic.BadRequestError, anthropic.NotFoundError, anthropic.PermissionDeniedError)

_lock = threading.Lock()
_latest = {}        # family -> {"id": ..., "name": ...}, from the Models API
_unusable = set()   # (model id, with refusal fallback?) pairs that were turned down
_client = None


def client():
    """The shared API client. ANTHROPIC_API_KEY comes from the environment."""
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def refresh():
    """Ask the Models API for the newest Opus and Sonnet. Returns what it found.

    Newest by version number, then by release date: a later snapshot of an
    older version does not outrank a newer version.
    """
    best = {}
    for model in client().models.list():
        release = _RELEASE.match(model.id)
        if not release:
            continue
        family = release.group(1)
        rank = (int(release.group(2)), int(release.group(3) or 0), model.created_at)
        if family not in best or rank > best[family][0]:
            best[family] = (rank, {"id": model.id, "name": model.display_name})
    found = {family: entry for family, (_, entry) in best.items()}
    with _lock:
        if found != _latest:
            logger.info("Claude models in use: %s",
                        ", ".join(f"{f} = {found[f]['id']}" for f in sorted(found)) or "none listed")
        _latest.clear()
        _latest.update(found)
        _unusable.clear()  # give a model that was turned down another chance
    return found


def family_of(model):
    """"opus" / "sonnet" for a family name or a model id of that family, else None."""
    if model in PINNED:
        return model
    match = _FAMILY.match(model or "")
    return match.group(1) if match else None


def resolve(model):
    """The model id to send for a family name or for a model id.

    An id of the Opus or Sonnet family stands for "the current one of that
    family": a conversation saved under last year's Opus continues on this
    year's. Other ids (Haiku, a local model) are returned as they are.
    """
    family = family_of(model)
    if family is None:
        return model
    return _latest.get(family, {}).get("id") or PINNED[family]


def display_name(model):
    """"Claude Opus 5.5" for whatever `resolve(model)` currently is."""
    model_id = resolve(model)
    for entry in _latest.values():
        if entry["id"] == model_id:
            return entry["name"]
    return NAMES.get(model_id, model_id)


def candidates(model):
    """The model ids to try for `model`, in order: the newest, then the pinned one."""
    chosen = resolve(model)
    ids = [chosen]
    pinned = PINNED.get(family_of(chosen))
    if pinned and pinned != chosen:
        ids.append(pinned)
    usable = [m for m in ids if (m, False) not in _unusable]
    return usable or ids[-1:]


def turned_down(model_id):
    """Remember that `model_id` rejected a request another candidate accepted."""
    with _lock:
        _unusable.update({(model_id, True), (model_id, False)})
    logger.warning("%s rejected a request; using %s until the next refresh",
                   model_id, PINNED.get(family_of(model_id), "the pinned model"))


def create(model, **request):
    """Send one Messages request and return the response.

    `model` is a family ("opus", "sonnet") or a model id. Each candidate is
    tried with the refusal fallback and then without it; the first form the API
    accepts wins, and the forms it rejected before that are not tried again.
    If every form is rejected the request itself is at fault, nothing is
    remembered, and the first error is raised.
    """
    forms = [(m, extra) for m in candidates(model) for extra in (True, False)
             if (m, extra) not in _unusable]
    forms = forms or [(candidates(model)[-1], False)]
    failed, first_error = [], None
    for model_id, with_fallback in forms:
        try:
            if with_fallback:
                response = client().beta.messages.create(
                    model=model_id, betas=[_REFUSAL_FALLBACK_BETA], fallbacks="default", **request)
            else:
                response = client().messages.create(model=model_id, **request)
        except REJECTED as error:
            first_error = first_error or error
            failed.append((model_id, with_fallback))
            continue
        if failed:
            with _lock:
                _unusable.update(failed)
            logger.warning("Claude request forms rejected and skipped from now on: %s (%s)",
                           failed, first_error)
        return response
    raise first_error


def reply_text(response):
    """The text of a reply, read by block type: a response can open with
    thinking blocks, and a declined request has no text at all."""
    if response.stop_reason == "refusal":
        return DECLINED
    return "".join(block.text for block in response.content if block.type == "text").strip()
