# AGENTS.md

Project-level instructions for AI agents working in this repository.
Read this file before doing anything else.

---

## 🌐 Services

| Service | URL |
| ------- | --- |
| Frontend | `http://localhost:3002` |
| Backend | `http://localhost:8000` |

---

## 🛢️ Database — Production (READ THIS TWICE)

The shared Postgres URL points to the **production database**.

> ⚠️ **DO NOT change any existing data.** No updates, no deletes, no "quick fixes" on existing rows.

**Allowed:**

- ✅ Create new orders or users to test
- ✅ Modify records **only when the user explicitly asks** you to modify them

**Never:**

- ❌ Modify or delete existing orders, users, or any other production data on your own initiative
- ❌ Run destructive migrations or truncate/reset anything

---

## 🌿 Git Policy

> ⚠️ **No commits, no pushes — unless the user explicitly asks.**

**Never:**

- ❌ `git commit` on your own initiative, even for "safe" or "obvious" changes
- ❌ `git push` to any branch or remote
- ❌ Creating branches, tags, or stashes without being asked

**Only commit or push when the user says so explicitly** (e.g. "commit this", "push to main"). When in doubt, make the changes and let the user review first.

---

## 🧹 Test Files & Test Data Policy

- **Never reuse existing test files** — always create your own fresh files for testing.
- When committing changes: **delete every test file you generated**.
- When committing changes: **delete all testing data you generated** (e.g. test orders, users, or any other records created for testing).

---

## 🔑 Testing Credentials

| Role | Credentials |
| ---- | ----------- |
| **Admin** | `admin@draep.com` / `draepadmintothemoon` |
| **User** | Phone: `7986147238` — OTP: `1221` (always) |
| **Style Captain** | `1111111111` / password: `password` |

---

*Last updated: 2026-09-09*
