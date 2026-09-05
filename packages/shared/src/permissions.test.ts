import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROLES, ROLE_LABELS } from "./roles.ts";
import {
  canSeeCompensation,
  hasPermission,
  PERMISSIONS,
  permissionsFor,
  ROLE_PERMISSIONS,
} from "./permissions.ts";

describe("the HR boundary", () => {
  /**
   * The boundary moved on 2026-08-15; it did not disappear.
   *
   * For most of this app's life the rule was that HR must never see a salary,
   * and it was enforced in six places. The owner changed it: their HR runs
   * pay, and a role that cannot see a salary cannot do that job.
   *
   * So the line is no longer between knowing and not knowing. It is between
   * deciding what someone earns and moving the money out of the bank — and
   * between one person's pay, which is HR's business, and what the company
   * holds, which is not.
   */
  it("lets HR see and set what people are paid", () => {
    assert.equal(hasPermission("hr", "team.compensation.read"), true);
    assert.equal(hasPermission("hr", "team.compensation.write"), true);
    assert.equal(canSeeCompensation("hr"), true);
  });

  it("lets HR read the salary sheet but not run it or pay it", () => {
    assert.equal(hasPermission("hr", "payroll.read"), true);
    assert.equal(hasPermission("hr", "payroll.write"), false);
    assert.equal(hasPermission("hr", "payroll.pay"), false);
  });

  it("still lets HR do the rest of its job", () => {
    assert.equal(hasPermission("hr", "team.read"), true);
    assert.equal(hasPermission("hr", "team.write"), true);
  });

  it("keeps the company's own money off HR's screens", () => {
    // Knowing every salary is not the same as knowing the bank balance, what
    // the CEO sent from abroad, or the month's totals. Letting the first
    // through does not open the second.
    assert.equal(hasPermission("hr", "dashboard.view"), true);
    assert.equal(hasPermission("hr", "dashboard.money"), false);
    assert.equal(hasPermission("hr", "reports.view"), false);
    assert.equal(hasPermission("hr", "transactions.read"), false);
  });

  it("grants compensation access to the money roles and to HR", () => {
    const allowed = ROLES.filter((role) => canSeeCompensation(role));
    assert.deepEqual(allowed, ["super_admin", "ceo", "hr", "cfo"]);
  });

  it("leaves paying the payroll to the roles that hold the bank", () => {
    // The one that matters most: this is money actually leaving.
    const canPay = ROLES.filter((role) => hasPermission(role, "payroll.pay"));
    assert.deepEqual(canPay, ["super_admin", "cfo"]);
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

describe("the retired roles", () => {
  /*
   * Admin and Finance were withdrawn on 5 Sep 2026 — Admin and CFO had held the
   * same permission array all along, so retiring Admin removed a name and not
   * a capability. These two assert the thing that would actually hurt: a row
   * still carrying one must not take the app down.
   */
  it("cannot be handed out any more", () => {
    assert.equal(ROLES.includes("admin" as never), false);
    assert.equal(ROLES.includes("finance" as never), false);
  });

  it("fail closed rather than throwing, if a row still carries one", () => {
    // `ROLE_PERMISSION_SETS[role]` is undefined for these, and `.has()` on
    // undefined THROWS — which would have been a 500 on every request such a
    // user made, not a refusal. No permissions is the safe answer.
    for (const retired of ["admin", "finance"] as const) {
      assert.doesNotThrow(() => hasPermission(retired, "dashboard.view"));
      assert.equal(hasPermission(retired, "dashboard.view"), false);
      assert.equal(hasPermission(retired, "settings.write"), false);
      assert.deepEqual([...permissionsFor(retired)], []);
    }
  });

  it("keep their names, so history can still say them", () => {
    // `audit_logs.actor_role` records the role somebody held at the time, and
    // those rows are never rewritten. A label that disappeared would leave an
    // August entry rendering blank.
    assert.equal(ROLE_LABELS.admin, "Admin");
    assert.equal(ROLE_LABELS.finance, "Finance");
  });
});

describe("the CFO runs operations but not the company", () => {
  it("holds every permission except the two that are super_admin's", () => {
    // Written out as "everything but these" rather than as a list, because a
    // list is what drifts: somebody adds a permission, nothing fails, and the
    // CFO quietly cannot do something they should.
    const missing = PERMISSIONS.filter(
      (permission) => !hasPermission("cfo", permission),
    );
    assert.deepEqual(missing, ["settings.write", "users.manage"]);
  });

  it("can do the operational work", () => {
    assert.equal(hasPermission("cfo", "transactions.write"), true);
    assert.equal(hasPermission("cfo", "payroll.pay"), true);
    assert.equal(hasPermission("cfo", "team.compensation.read"), true);
  });

  it("cannot change settings or manage users", () => {
    // The two that stay with super_admin alone. Named separately from the
    // comparison above because this is the boundary, not a consequence of it —
    // if admin ever gained either, this test must still fail.
    assert.equal(hasPermission("cfo", "settings.write"), false);
    assert.equal(hasPermission("cfo", "users.manage"), false);
  });

  it("can record a challan, which is what it was added for", () => {
    assert.equal(hasPermission("cfo", "tds.read"), true);
    assert.equal(hasPermission("cfo", "tds.write"), true);
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
