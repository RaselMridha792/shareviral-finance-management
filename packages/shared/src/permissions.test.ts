import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROLES } from "./roles.ts";
import {
  canSeeCompensation,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
  ROLE_PERMISSIONS,
} from "./permissions.ts";

describe("the HR boundary", () => {
  // The single most important rule in the app: HR manages people but must
  // never see what they are paid.
  it("denies HR every compensation permission", () => {
    assert.equal(hasPermission("hr", "team.compensation.read"), false);
    assert.equal(hasPermission("hr", "team.compensation.write"), false);
    assert.equal(canSeeCompensation("hr"), false);
  });

  it("denies HR every payroll permission", () => {
    assert.equal(hasPermission("hr", "payroll.read"), false);
    assert.equal(hasPermission("hr", "payroll.write"), false);
    assert.equal(hasPermission("hr", "payroll.pay"), false);
  });

  it("still lets HR do its actual job", () => {
    assert.equal(hasPermission("hr", "team.read"), true);
    assert.equal(hasPermission("hr", "team.write"), true);
  });

  it("keeps money off HR's dashboard", () => {
    assert.equal(hasPermission("hr", "dashboard.view"), true);
    assert.equal(hasPermission("hr", "dashboard.money"), false);
  });

  it("grants compensation access to exactly the four money roles", () => {
    const allowed = ROLES.filter((role) => canSeeCompensation(role));
    assert.deepEqual(allowed, ["super_admin", "ceo", "admin", "finance"]);
  });
});

describe("the CEO is read-only", () => {
  const writePermissions = PERMISSIONS.filter(
    (p) =>
      p.endsWith(".write") ||
      p.endsWith(".pay") ||
      p.endsWith(".void") ||
      p === "users.manage" ||
      p === "imports.run",
  );

  it("holds no permission that changes anything", () => {
    for (const permission of writePermissions) {
      assert.equal(
        hasPermission("ceo", permission),
        false,
        `ceo must not hold ${permission}`,
      );
    }
  });

  it("can still see the money and the audit log", () => {
    assert.equal(hasPermission("ceo", "dashboard.money"), true);
    assert.equal(hasPermission("ceo", "reports.usd"), true);
    assert.equal(hasPermission("ceo", "audit.read"), true);
  });
});

describe("super_admin is the only one who can change settings or users", () => {
  for (const permission of ["settings.write", "users.manage"] as const) {
    it(`grants ${permission} to super_admin alone`, () => {
      const allowed = ROLES.filter((role) => hasPermission(role, permission));
      assert.deepEqual(allowed, ["super_admin"]);
    });
  }

  it("gives super_admin everything", () => {
    assert.equal(permissionsFor("super_admin").length, PERMISSIONS.length);
  });
});

describe("admin runs operations but not the company", () => {
  it("can do the operational work", () => {
    assert.equal(hasPermission("admin", "transactions.write"), true);
    assert.equal(hasPermission("admin", "payroll.pay"), true);
    assert.equal(hasPermission("admin", "team.compensation.read"), true);
  });

  it("cannot change settings or manage users", () => {
    assert.equal(hasPermission("admin", "settings.write"), false);
    assert.equal(hasPermission("admin", "users.manage"), false);
  });
});

describe("matrix integrity", () => {
  it("defines permissions for every role", () => {
    for (const role of ROLES) {
      assert.ok(
        Array.isArray(ROLE_PERMISSIONS[role]),
        `${role} has no permission list`,
      );
    }
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        assert.ok(known.has(permission), `${role} holds unknown ${permission}`);
      }
    }
  });

  it("has no duplicates in the vocabulary", () => {
    assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  });

  it("returns false for an unauthenticated caller", () => {
    assert.equal(hasPermission(undefined, "dashboard.view"), false);
    assert.equal(canSeeCompensation(undefined), false);
  });
});
