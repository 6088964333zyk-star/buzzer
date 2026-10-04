"""
Integration tests for the T4 admin course access list
(GET /api/admin/courses/{id}/access). See docs/design-t4-admin.md, section 5.

Set-once course assignment through the admin API is covered by
test_host_api.py::test_admin_can_assign_course_once and isn't repeated here.
"""

from __future__ import annotations

import uuid

import httpx
import pytest

_T = 10.0
_PASSWORD = "Passw0rd!x"


class AccessWorld:
    """A course with two local users: one HOST ("Zed") and one PLAYER ("amy")."""

    def __init__(self, base_url: str, admin_token: str):
        self.base = base_url
        self.admin = {"Authorization": f"Bearer {admin_token}"}
        self.tag = uuid.uuid4().hex[:6]
        self.user_ids: list[str] = []
        self.course = self.new_course("Access")
        # Names chosen so the HOST sorts first only because of its role.
        self.host = self._user("Zed", self.course, "HOST")
        self.player = self._user("amy", self.course, "PLAYER")

    def url(self, path: str) -> str:
        return f"{self.base}/api{path}"

    def new_course(self, name: str) -> int:
        r = httpx.post(
            self.url("/admin/courses"),
            json={"name": f"Admin Access {name} {self.tag}", "semester": "Test"},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def _user(self, name: str, course_id: int, role: str) -> dict:
        username = f"{name.lower()}_{self.tag}"
        r = httpx.post(
            self.url("/admin/users"),
            json={"username": username, "display_name": name, "password": _PASSWORD},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 201, r.text
        user_id = r.json()["id"]
        self.user_ids.append(user_id)
        self.grant(user_id, course_id, role)
        r = httpx.post(
            self.url("/auth/login"),
            json={"username": username, "password": _PASSWORD},
            timeout=_T,
        )
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        return {"id": user_id, "h": {"Authorization": f"Bearer {token}"}}

    def grant(self, user_id: str, course_id: int, role: str) -> None:
        r = httpx.post(
            self.url(f"/admin/users/{user_id}/course-access"),
            json={"course_id": course_id, "role": role},
            headers=self.admin,
            timeout=_T,
        )
        assert r.status_code == 204, r.text

    def access(self, course_id: int, headers: dict | None = None) -> httpx.Response:
        return httpx.get(
            self.url(f"/admin/courses/{course_id}/access"),
            headers=self.admin if headers is None else headers,
            timeout=_T,
        )

    def cleanup(self):
        # Courses have no DELETE endpoint and are left as inert records (as in conftest).
        for uid in self.user_ids:
            httpx.delete(
                self.url(f"/admin/users/{uid}"), headers=self.admin, timeout=_T
            )


@pytest.fixture()
def world(docker_stack, base_url, admin_token):
    w = AccessWorld(base_url, admin_token)
    yield w
    w.cleanup()


def _roles(entries: list[dict]) -> list[tuple[str, str]]:
    return [(e["user_id"], e["course_role"]) for e in entries]


def test_lists_grants_hosts_first(world: AccessWorld):
    r = world.access(world.course)
    assert r.status_code == 200, r.text
    entries = r.json()
    # "Zed" would sort after "amy" by name; HOST comes first regardless.
    assert _roles(entries) == [
        (world.host["id"], "HOST"),
        (world.player["id"], "PLAYER"),
    ]
    host = entries[0]
    assert host["display_name"] == "Zed"
    assert host["username"] == f"zed_{world.tag}"
    assert host["user_role"] == "USER"
    assert set(host) == {
        "user_id",
        "username",
        "netid",
        "display_name",
        "user_role",
        "course_role",
    }


def test_reflects_role_change_and_revoke(world: AccessWorld):
    world.grant(world.player["id"], world.course, "HOST")
    entries = world.access(world.course).json()
    # Both HOST now, so name order decides: "amy" before "Zed" (case-insensitive).
    assert _roles(entries) == [(world.player["id"], "HOST"), (world.host["id"], "HOST")]

    r = httpx.delete(
        world.url(f"/admin/users/{world.host['id']}/course-access/{world.course}"),
        headers=world.admin,
        timeout=_T,
    )
    assert r.status_code == 204, r.text
    assert _roles(world.access(world.course).json()) == [(world.player["id"], "HOST")]


def test_empty_course_and_missing_course(world: AccessWorld):
    empty = world.new_course("Empty")
    r = world.access(empty)
    assert r.status_code == 200, r.text
    assert r.json() == []

    r = world.access(999_999_999)
    assert r.status_code == 404
    assert "not found" in r.json()["message"]


def test_admin_only(world: AccessWorld):
    # A HOST of this very course still can't read the admin access list.
    r = world.access(world.course, headers=world.host["h"])
    assert r.status_code == 403
    r = world.access(world.course, headers={})
    assert r.status_code == 401
