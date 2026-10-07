import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
const url = process.env.TASK_TEST_DATABASE_URL;
test("database: partner storage rejects duplicate identity, stale writes and browser access", { skip: !url }, () => {
  const sql = `begin;
    insert into students(subject_id,email,sealed_token) values ('partner-test','partner@example.test','unused');
    insert into partner_claims(student_id,id,version,document) values ('partner-test','test',1,'{"id":"test","version":1}');
    do $$ declare n integer; begin
      begin
        insert into partner_claims(student_id,id,version,document) values ('partner-test','test',1,'{"id":"test","version":1}');
        raise exception 'duplicate accepted';
      exception when unique_violation then null; end;
      update partner_claims set version=2, document='{"id":"test","version":2}' where student_id='partner-test' and id='test' and version=1;
      get diagnostics n = row_count; if n <> 1 then raise exception 'update failed'; end if;
      update partner_claims set version=3, document='{"id":"test","version":3}' where student_id='partner-test' and id='test' and version=1;
      get diagnostics n = row_count; if n <> 0 then raise exception 'stale update succeeded'; end if;
      if has_table_privilege('anon','partner_claims','SELECT') or has_table_privilege('authenticated','partner_claims','UPDATE') then raise exception 'browser has access'; end if;
      if not (select relrowsecurity from pg_class where oid='partner_claims'::regclass) then raise exception 'RLS missing'; end if;
    end $$;
    rollback;`;
  assert.doesNotThrow(() => execFileSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }));
});
