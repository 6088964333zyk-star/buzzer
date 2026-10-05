"""
Integration tests for T8 image support (docs/design-t8-images.md, Step 9).
Uses the host-API fixtures from test_host_api.py; images are generated with
Pillow in memory.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from .conftest import create_guest_tokens
from .engine.socket_client import TestSocketClient
from .test_host_api import MC_QUESTION, World, _finish, _start_session

_T = 10.0


def _png(size=(40, 20), color="red") -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def world(docker_stack, base_url, admin_token):
    w = World(base_url, admin_token)
    yield w
    w.cleanup()


def _upload(world: World, game: int, data: bytes, headers=None, prefix="/host") -> httpx.Response:
    return httpx.post(
        world.url(f"{prefix}/games/{game}/images"),
        files={"file": ("pic.png", data, "image/png")},
        headers=headers or world.host_a["h"],
        timeout=_T,
    )


def _replace(world: World, image_id: str, data: bytes, headers=None) -> httpx.Response:
    return httpx.put(
        world.url(f"/host/images/{image_id}"),
        files={"file": ("new.png", data, "image/png")},
        headers=headers or world.host_a["h"],
        timeout=_T,
    )


def _question(world: World, game: int, body: dict) -> httpx.Response:
    return httpx.post(
        world.url(f"/host/games/{game}/questions"), json=body, headers=world.host_a["h"], timeout=_T
    )


def _map_question(image_id: str | None) -> dict:
    config: dict = {"aspectRatio": 2}
    if image_id:
        config["mapImageId"] = image_id
    return {
        "type": "map_pin",
        "grading_type": "ACCURACY",
        "prompt": "Where is the library?",
        "config": config,
        "answer_data": {"target": {"x": 0.5, "y": 0.5}, "fullRadius": 0.05, "zeroRadius": 0.3},
        "points_value": 1,
        "time_limit_seconds": 60,
    }


# ---------------------------------------------------------------------------
# Upload, public GET, replace, delete (D2, D5)
# ---------------------------------------------------------------------------


def test_upload_serve_replace_delete(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    data = _png()
    r = _upload(world, game, data)
    assert r.status_code == 201, r.text
    img = r.json()
    assert (img["mime"], img["width"], img["height"], img["used_by"]) == ("image/png", 40, 20, [])

    listed = httpx.get(world.url(f"/host/games/{game}/images"), headers=world.host_a["h"]).json()
    assert [i["id"] for i in listed] == [img["id"]]

    # Public: no auth header at all.
    pub = world.url(f"/images/{img['id']}")
    r = httpx.get(pub)
    assert r.status_code == 200 and r.content == data
    assert r.headers["content-type"] == "image/png"
    assert r.headers["cache-control"] == "no-cache"
    etag = r.headers["etag"]
    assert httpx.get(pub, headers={"If-None-Match": etag}).status_code == 304

    new = _png(color="blue")
    r = _replace(world, img["id"], new)
    assert r.status_code == 200 and r.json()["id"] == img["id"]
    r = httpx.get(pub, headers={"If-None-Match": etag})
    assert r.status_code == 200 and r.content == new and r.headers["etag"] != etag

    assert httpx.delete(world.url(f"/host/images/{img['id']}"), headers=world.host_a["h"]).status_code == 204
    assert httpx.get(pub).status_code == 404


def test_bad_uploads_are_rejected(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    r = _upload(world, game, svg)
    assert r.status_code == 422 and "Unsupported image type" in r.json()["message"]
    assert httpx.get(world.url(f"/host/games/{game}/images"), headers=world.host_a["h"]).json() == []


def test_access_follows_the_games_course(world: World):
    other_game = world.admin_game(world.course_b)
    r = _upload(world, other_game, _png(), headers=world.admin, prefix="/admin")
    assert r.status_code == 201, r.text
    image_id = r.json()["id"]
    h = world.host_a["h"]  # host of course A only
    assert httpx.get(world.url(f"/host/games/{other_game}/images"), headers=h).status_code == 403
    assert _upload(world, other_game, _png()).status_code == 403
    assert _replace(world, image_id, _png()).status_code == 403
    assert httpx.delete(world.url(f"/host/images/{image_id}"), headers=h).status_code == 403
    assert httpx.get(world.url(f"/images/{image_id}")).status_code == 200  # still there


# ---------------------------------------------------------------------------
# Question references (config rules, D4, D7)
# ---------------------------------------------------------------------------


def test_option_and_prompt_images_round_trip_and_ownership(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    a, b = (_upload(world, game, _png(color=c)).json()["id"] for c in ("red", "green"))
    body = {
        **MC_QUESTION,
        "config": {**MC_QUESTION["config"], "imageId": a, "optionImages": [b, None, a]},
    }
    r = _question(world, game, body)
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    assert r.json()["config"]["optionImages"] == [b, None, a]

    listed = httpx.get(world.url(f"/host/games/{game}/images"), headers=world.host_a["h"]).json()
    assert {i["id"]: i["used_by"] for i in listed} == {a: [1], b: [1]}

    # Wrong length, and another game's image.
    bad_len = {**body, "config": {**body["config"], "optionImages": [b]}}
    assert _question(world, game, bad_len).status_code == 422
    other = world.host_game(world.host_a["h"], world.course_a)
    foreign = _upload(world, other, _png()).json()["id"]
    r = _question(world, game, {**body, "config": {**body["config"], "imageId": foreign}})
    assert r.status_code == 422 and "does not belong to this game" in r.json()["message"]

    # In use: delete is refused with the question number.
    r = httpx.delete(world.url(f"/host/images/{b}"), headers=world.host_a["h"])
    assert r.status_code == 409 and "question(s) 1" in r.json()["message"]

    # Leaving imageId out of the config removes the prompt image.
    new_config = {"options": MC_QUESTION["config"]["options"], "optionImages": [b, None, None]}
    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"config": new_config},
        headers=world.host_a["h"],
    )
    assert r.status_code == 200 and "imageId" not in r.json()["config"]
    assert httpx.delete(world.url(f"/host/images/{a}"), headers=world.host_a["h"]).status_code == 204


def test_map_pin_aspect_comes_from_its_image(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    image_id = _upload(world, game, _png(size=(300, 200))).json()["id"]
    r = _question(world, game, _map_question(image_id))
    assert r.status_code == 201, r.text
    assert r.json()["config"]["aspectRatio"] == 1.5

    # Another shape is refused; the same shape is fine.
    r = _replace(world, image_id, _png(size=(200, 200)))
    assert r.status_code == 409 and "keep its shape" in r.json()["message"]
    assert _replace(world, image_id, _png(size=(600, 400), color="blue")).status_code == 200

    # Without an image, the built-in world map's 2:1.
    r = _question(world, game, {**_map_question(None), "config": {"aspectRatio": 7}})
    assert r.status_code == 201 and r.json()["config"]["aspectRatio"] == 2.0


async def test_answered_map_keeps_its_map_and_live_rooms_lock_images(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    map_image = _upload(world, game, _png(size=(300, 200))).json()["id"]
    prompt_image = _upload(world, game, _png(color="green")).json()["id"]
    body = _map_question(map_image)
    body["config"]["imageId"] = prompt_image
    qid = _question(world, game, body).json()["id"]

    # Answer the map question once.
    r = world.room(world.host_a["h"], world.course_a, game)
    room_code = r.json()["room_code"]
    (token,) = create_guest_tokens(world.base, room_code, 1)
    host = TestSocketClient(world.base, world.host_a["token"], "host")
    player = TestSocketClient(world.base, token, "player")
    await host.connect()
    await player.connect()
    await host.emit("join_room", {"room_code": room_code, "role": "HOST"})
    await player.emit("join_room", {"room_code": room_code, "role": "PLAYER"})
    await host.wait_for("sync_state", _T)
    await player.wait_for("sync_state", _T)
    await host.emit("host_advance", {})
    question = await player.wait_for("new_question", _T)
    assert question["config"]["mapImageId"] == map_image
    await player.emit(
        "submit_answer",
        {
            "question_id": question["questionId"],
            "answer_data": {"point": {"x": 0.5, "y": 0.5}},
            "answer_time_ms": 500,
        },
    )
    await player.wait_for("answer_received", _T)

    # While the room is live, images can't be replaced or deleted.
    assert _replace(world, prompt_image, _png(color="blue")).status_code == 409
    assert httpx.delete(world.url(f"/host/images/{prompt_image}"), headers=world.host_a["h"]).status_code == 409
    await _finish(host, player, n_questions=1)

    # Answered: the map can't change, by replace or by switching mapImageId...
    r = _replace(world, map_image, _png(size=(600, 400), color="blue"))
    assert r.status_code == 409 and "answered" in r.json()["message"]
    other_map = _upload(world, game, _png(size=(300, 200), color="blue")).json()["id"]
    r = httpx.put(
        world.url(f"/host/games/{game}/questions/{qid}"),
        json={"config": {"aspectRatio": 2, "mapImageId": other_map, "imageId": prompt_image}},
        headers=world.host_a["h"],
    )
    assert r.status_code == 409 and "map" in r.json()["message"]
    # ...but the prompt image may still be replaced.
    assert _replace(world, prompt_image, _png(color="blue")).status_code == 200


async def test_question_edits_with_images_still_blocked_in_live_room(world: World):
    game = world.host_game(world.host_a["h"], world.course_a)
    world.add_question(world.host_a["h"], game)
    _, host, player = await _start_session(world, game, world.course_a, answer=False)
    try:
        # Uploading is allowed during a live room (no question uses it yet).
        assert _upload(world, game, _png()).status_code == 201
    finally:
        await _finish(host, player, n_questions=1)


# ---------------------------------------------------------------------------
# Export / import (D6)
# ---------------------------------------------------------------------------


def test_export_import_version_2_round_trip(world: World):
    game = world.admin_game(world.course_a)
    a = _upload(world, game, _png(size=(300, 200)), headers=world.admin, prefix="/admin").json()["id"]
    b = _upload(world, game, _png(color="green"), headers=world.admin, prefix="/admin").json()["id"]
    for body in (
        {**MC_QUESTION, "config": {**MC_QUESTION["config"], "imageId": b, "optionImages": [a, None, b]}},
        _map_question(a),
    ):
        r = httpx.post(world.url(f"/admin/games/{game}/questions"), json=body, headers=world.admin)
        assert r.status_code == 201, r.text

    exported = httpx.get(world.url(f"/admin/games/{game}/export"), headers=world.admin).json()
    assert exported["version"] == 2
    refs = [i["ref"] for i in exported["images"]]
    assert refs == ["img1", "img2"]
    mc, mp = exported["questions"]
    assert mc["config"]["imageId"] == "img2" and mc["config"]["optionImages"] == ["img1", None, "img2"]
    assert mp["config"]["mapImageId"] == "img1"

    r = httpx.post(
        world.url("/admin/games/import"),
        headers=world.admin,
        files={"file": ("g.json", json.dumps(exported), "application/json")},
        data={"course_id": world.course_a},
    )
    assert r.status_code == 201, r.text
    new_game = r.json()["game_id"]
    world.game_ids.append(new_game)
    images = httpx.get(world.url(f"/admin/games/{new_game}/images"), headers=world.admin).json()
    assert len(images) == 2 and {i["id"] for i in images}.isdisjoint({a, b})
    by_ref = dict(zip(refs, [i["id"] for i in images]))
    q1, q2 = world.questions(new_game)
    assert q1["config"]["optionImages"] == [by_ref["img1"], None, by_ref["img2"]]
    assert q2["config"]["mapImageId"] == by_ref["img1"] and q2["config"]["aspectRatio"] == 1.5
    same = httpx.get(world.url(f"/images/{by_ref['img1']}")).content
    assert same == base64.b64decode(exported["images"][0]["data"])


def test_import_rejects_bad_images_and_unknown_refs(world: World):
    def post(bundle: dict) -> httpx.Response:
        return httpx.post(
            world.url("/admin/games/import"),
            headers=world.admin,
            files={"file": ("g.json", json.dumps(bundle), "application/json")},
            data={"course_id": world.course_a},
        )

    base = {"format": "buzzer/game", "version": 2, "game": {"title": f"Bad import {world.tag}"}}
    good_image = {"ref": "img1", "data": base64.b64encode(_png()).decode()}
    q = {**MC_QUESTION, "config": {**MC_QUESTION["config"], "imageId": "img9"}}

    r = post({**base, "images": [good_image], "questions": [q]})
    assert r.status_code == 422 and "unknown image ref img9" in r.json()["detail"]
    r = post({**base, "images": [good_image, good_image], "questions": []})
    assert r.status_code == 422 and "invalid or duplicated" in r.json()["detail"]
    svg = {"ref": "img1", "data": base64.b64encode(b"<svg></svg>").decode()}
    r = post({**base, "images": [svg], "questions": []})
    assert r.status_code == 422 and r.json()["detail"].startswith("Image img1 invalid")

    # Nothing from the failed imports was kept.
    titles = [g["title"] for g in httpx.get(world.url("/admin/games"), headers=world.admin).json()]
    assert f"Bad import {world.tag}" not in titles

    # A version-1 file still imports.
    r = post({**base, "version": 1, "questions": [MC_QUESTION]})
    assert r.status_code == 201, r.text
    world.game_ids.append(r.json()["game_id"])
